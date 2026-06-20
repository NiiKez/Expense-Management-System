/**
 * ts-jest AST transformer: rewrites `import.meta.env.X` → `process.env.X`
 * at compile time so Vite-idiom app code works under Jest/Node without changes.
 *
 * Registered in jest.config.ts under transform[ts-jest].astTransformers.before.
 * ts-jest 29 calls factory(compilerInstance, pluginOptions) — the TypeScript
 * compiler module is not injected, so we require it directly.
 */

import * as typescript from 'typescript';
import type * as ts from 'typescript';

export const name = 'importMetaTransformer';
export const version = 1;

/**
 * ts-jest 29 calls `factory(compilerInstance, pluginOptions)` and uses the
 * return value directly as a TypeScript transformer:
 *   (ctx: TransformationContext) => (sourceFile: SourceFile) => SourceFile
 */
export function factory(
  compilerInstance: unknown,
  pluginOptions: unknown
): (ctx: ts.TransformationContext) => (sourceFile: ts.SourceFile) => ts.SourceFile {
  void compilerInstance;
  void pluginOptions;

  function visitNode(node: ts.Node, ctx: ts.TransformationContext): ts.Node {
    // Rewrite: import.meta.env.FOO  →  process.env.FOO
    // The shape is: PropertyAccess( PropertyAccess( MetaProperty(import.meta), env ), FOO )
    if (typescript.isPropertyAccessExpression(node)) {
      const expr = node.expression;
      if (
        typescript.isPropertyAccessExpression(expr) &&
        typescript.isMetaProperty(expr.expression) &&
        expr.name.text === 'env'
      ) {
        return ctx.factory.createPropertyAccessExpression(
          ctx.factory.createPropertyAccessExpression(
            ctx.factory.createIdentifier('process'),
            ctx.factory.createIdentifier('env')
          ),
          node.name
        );
      }

      // Rewrite: import.meta.env  →  process.env  (bare, without a further property access)
      if (
        typescript.isMetaProperty(expr) &&
        node.name.text === 'env'
      ) {
        return ctx.factory.createPropertyAccessExpression(
          ctx.factory.createIdentifier('process'),
          ctx.factory.createIdentifier('env')
        );
      }
    }

    return typescript.visitEachChild(
      node,
      (child) => visitNode(child, ctx),
      ctx
    );
  }

  return (ctx: ts.TransformationContext) =>
    (sourceFile: ts.SourceFile): ts.SourceFile => {
      return typescript.visitNode(
        sourceFile,
        (node) => visitNode(node, ctx)
      ) as ts.SourceFile;
    };
}
