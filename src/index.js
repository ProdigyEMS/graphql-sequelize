/**
 * Return the value behind a Babel-generated default export while leaving
 * native CommonJS and named-export modules unchanged.
 *
 * @param {Object|Function} requiredModule a value returned by require()
 * @return {*} the module's public CommonJS value
 */
function unwrapDefault(requiredModule) {
  if (
    requiredModule &&
    requiredModule.__esModule &&
    Object.prototype.hasOwnProperty.call(requiredModule, 'default')
  ) {
    return requiredModule.default;
  }

  return requiredModule;
}

const relay = require('./relay');

module.exports = {
  argsToFindOptions: unwrapDefault(require('./argsToFindOptions')),
  resolver: unwrapDefault(require('./resolver')),
  defaultListArgs: unwrapDefault(require('./defaultListArgs')),
  defaultArgs: unwrapDefault(require('./defaultArgs')),
  typeMapper: require('./typeMapper'),
  attributeFields: unwrapDefault(require('./attributeFields')),
  simplifyAST: unwrapDefault(require('./simplifyAST')),
  relay,
  sequelizeConnection: relay.sequelizeConnection,
  createConnection: relay.createConnection,
  createConnectionResolver: relay.createConnectionResolver,
  createNodeInterface: relay.createNodeInterface,
  JSONType: unwrapDefault(require('./types/jsonType')),
  DateType: unwrapDefault(require('./types/dateType')),
};
