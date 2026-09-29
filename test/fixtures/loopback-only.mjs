// Test-only network containment for CLI serve, which has no host flag.
import http from 'node:http';
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (port, callback) {
  this.once('listening', () => process.stderr.write(`FIXTURE_PORT=${this.address().port}\n`));
  return listen.call(this, port, '127.0.0.1', callback);
};
