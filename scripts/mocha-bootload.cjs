// Chai plugin registration. Transpilation is handled by the pretest build
// step (see the `build:test` script) rather than a require hook -- Mocha 9+
// loads spec files through dynamic import(), which bypasses require.extensions
// and therefore any @babel/register hook.
var chai = require('chai');

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));
