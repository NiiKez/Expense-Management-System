/**
 * Static guardrails for the docker/ stack.
 *
 * These parse the committed compose files, monitoring configs and Dockerfiles
 * and assert the security/correctness invariants the stack relies on, so a
 * future edit can't silently undo them. No Docker daemon is required — the
 * end-to-end behaviour (proxy allow/deny, log shipping) is exercised manually;
 * here we lock the configuration that makes that behaviour possible.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const DOCKER_DIR = path.resolve(__dirname, '../../../../docker');

interface ComposeService {
  image?: string;
  build?: unknown;
  ports?: string[];
  environment?: string[] | Record<string, string>;
  volumes?: string[];
  security_opt?: string[];
  cap_drop?: string[];
  read_only?: boolean;
  user?: string;
  command?: string | string[];
  mem_limit?: string;
  pids_limit?: number;
  healthcheck?: { test?: string[] | string };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
}

function readText(rel: string): string {
  return fs.readFileSync(path.join(DOCKER_DIR, rel), 'utf8');
}

function loadCompose(rel: string): ComposeFile {
  return yaml.load(readText(rel)) as ComposeFile;
}

function envList(svc: ComposeService): string[] {
  const env = svc.environment;
  if (!env) return [];
  if (Array.isArray(env)) return env;
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

function healthcheckCmd(svc: ComposeService): string {
  const t = svc.healthcheck?.test;
  if (!t) return '';
  return Array.isArray(t) ? t.join(' ') : t;
}

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.test.yml',
  'docker-compose.e2e.yml',
  // override is gitignored (local-only debugging file), so it is absent on a
  // clean checkout / in CI. Validate it when present, but skip it otherwise —
  // reading it unconditionally would throw ENOENT at collection time and fail
  // the whole suite everywhere except a machine that happens to have it.
  'docker-compose.override.yml',
].filter((f) => fs.existsSync(path.join(DOCKER_DIR, f)));

describe('docker images are pinned by digest', () => {
  for (const file of COMPOSE_FILES) {
    const compose = loadCompose(file);
    const services = compose.services ?? {};
    for (const [name, svc] of Object.entries(services)) {
      if (!svc.image) continue; // build-based services have no image to pin
      it(`${file} → ${name} pins ${svc.image.split('@')[0]} by @sha256 digest`, () => {
        expect(svc.image).toMatch(/@sha256:[a-f0-9]{64}$/);
      });
    }
  }
});

describe('every service in the main stack is hardened', () => {
  const compose = loadCompose('docker-compose.yml');
  for (const [name, svc] of Object.entries(compose.services)) {
    it(`${name} sets no-new-privileges`, () => {
      expect(svc.security_opt ?? []).toContain('no-new-privileges:true');
    });
    it(`${name} drops ALL capabilities`, () => {
      expect(svc.cap_drop ?? []).toContain('ALL');
    });
  }
});

describe('Docker socket is never exposed to a log-shipping process (H1)', () => {
  const compose = loadCompose('docker-compose.yml');
  const SOCKET = '/var/run/docker.sock';

  it('only docker-socket-proxy mounts the Docker socket', () => {
    const mounters = Object.entries(compose.services)
      .filter(([, svc]) => (svc.volumes ?? []).some((v) => v.includes(SOCKET)))
      .map(([name]) => name);
    expect(mounters).toEqual(['docker-socket-proxy']);
  });

  it('the proxy mounts the socket read-only', () => {
    const vols = compose.services['docker-socket-proxy'].volumes ?? [];
    expect(vols.some((v) => v.startsWith(`${SOCKET}:`) && v.endsWith(':ro'))).toBe(true);
  });

  it('the proxy denies all writes and exposes only the read scopes promtail needs', () => {
    const env = envList(compose.services['docker-socket-proxy']);
    expect(env).toContain('POST=0');
    expect(env).toContain('CONTAINERS=1');
    expect(env).toContain('NETWORKS=1');
    // Sensitive scopes must stay off.
    expect(env).toContain('EXEC=0');
    expect(env).toContain('IMAGES=0');
  });

  it('promtail does not mount the socket and talks to the proxy over TCP', () => {
    const promtail = compose.services['promtail'];
    expect((promtail.volumes ?? []).some((v) => v.includes(SOCKET))).toBe(false);

    const promtailConfig = readText('promtail/promtail-config.yml');
    expect(promtailConfig).toContain('host: tcp://docker-socket-proxy:2375');
    expect(promtailConfig).not.toContain('unix:///var/run/docker.sock');
  });
});

describe('promtail runs non-root with a read-only root filesystem', () => {
  const promtail = loadCompose('docker-compose.yml').services['promtail'];
  it('runs as a non-root user', () => {
    expect(promtail.user).toBe('10001:10001');
  });
  it('uses a read-only root filesystem', () => {
    expect(promtail.read_only).toBe(true);
  });
});

describe('the app service keeps its production security posture', () => {
  const app = loadCompose('docker-compose.yml').services['app'];
  it('runs read-only', () => {
    expect(app.read_only).toBe(true);
  });
  it('pins stub auth off and NODE_ENV to production', () => {
    const env = envList(app);
    expect(env).toContain('ALLOW_STUB_AUTH=false');
    expect(env).toContain('NODE_ENV=production');
  });
});

describe('no published port is bound to a public interface', () => {
  const loopback = /^(127\.0\.0\.1|\$\{APP_BIND_HOST:-127\.0\.0\.1\}):/;
  for (const file of COMPOSE_FILES) {
    const compose = loadCompose(file);
    for (const [name, svc] of Object.entries(compose.services ?? {})) {
      for (const mapping of svc.ports ?? []) {
        it(`${file} → ${name} publishes ${mapping} on loopback only`, () => {
          expect(mapping).toMatch(loopback);
        });
      }
    }
  }
});

describe('MySQL healthchecks keep the password off the process argv', () => {
  const files: Array<[string, string]> = [
    ['docker-compose.yml', 'mysql'],
    ['docker-compose.test.yml', 'mysql-test'],
    ['docker-compose.e2e.yml', 'mysql-e2e'],
  ];
  for (const [file, svc] of files) {
    it(`${file} → ${svc} uses MYSQL_PWD, not -p on the command line`, () => {
      const cmd = healthcheckCmd(loadCompose(file).services[svc]);
      expect(cmd).toContain('MYSQL_PWD=');
      expect(cmd).not.toMatch(/-p"/);
    });
  }
});

describe('the integration test-runner is bounded and invokes jest directly', () => {
  const compose = loadCompose('docker-compose.test.yml');
  const runner = compose.services['test-runner'];
  const cmd = Array.isArray(runner.command) ? runner.command.join(' ') : runner.command ?? '';

  it('invokes the local jest binary instead of npx', () => {
    expect(cmd).toContain('node_modules/.bin/jest');
    expect(cmd).not.toContain('npx ');
  });
  it('caps memory and process count', () => {
    expect(runner.mem_limit).toBeDefined();
    expect(runner.pids_limit).toBeDefined();
  });
});

describe('Loki config is sane', () => {
  const loki = yaml.load(readText('loki/loki-config.yml')) as Record<string, unknown>;
  it('has no ruler pointing at a non-existent Alertmanager', () => {
    expect(loki.ruler).toBeUndefined();
  });
  it('retains logs long enough to correlate with the 15d metric window', () => {
    const limits = loki.limits_config as { retention_period?: string } | undefined;
    expect(limits?.retention_period).toBe('360h');
  });
});

describe('production Dockerfile invariants', () => {
  const dockerfile = fs.readFileSync(path.join(DOCKER_DIR, 'Dockerfile'), 'utf8');
  it('runs as a non-root user', () => {
    expect(dockerfile).toMatch(/^USER appuser$/m);
  });
  it('keeps a HEALTHCHECK', () => {
    expect(dockerfile).toContain('HEALTHCHECK');
  });
  it('installs production deps only, with scripts disabled', () => {
    expect(dockerfile).toContain('--omit=dev');
    expect(dockerfile).toContain('--ignore-scripts');
  });
  it('pins the tini package version', () => {
    expect(dockerfile).toMatch(/apk add --no-cache tini=[\d.r-]+/);
  });
  it('carries OCI source metadata', () => {
    expect(dockerfile).toContain('org.opencontainers.image.source');
  });
});

describe('dockerignore files', () => {
  it('the root ignore excludes env files and secrets from the build context', () => {
    const ignore = fs.readFileSync(path.resolve(DOCKER_DIR, '..', '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\*\.pem$/m);
    expect(ignore).toMatch(/^\*\.key$/m);
  });
  it('the test-runner ignore KEEPS test sources (so jest finds them)', () => {
    const ignore = readText('Dockerfile.test.dockerignore');
    expect(ignore).not.toMatch(/^\*\*\/\*\.test\.ts$/m);
    expect(ignore).not.toMatch(/^\*\*\/__tests__/m);
  });
});
