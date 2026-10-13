const swc = require('next/dist/build/swc');

module.exports = function compileActualComponent(source) {
  const done = this.async();
  swc.loadBindings().then(() => {
    const result = swc.transformSync(source, {
      filename: this.resourcePath,
      jsc: { parser: { syntax: 'typescript', tsx: this.resourcePath.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
      module: { type: 'es6' },
    });
    done(null, result.code);
  }, done);
};
