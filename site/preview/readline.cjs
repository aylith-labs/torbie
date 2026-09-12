const readline = require('readline-browserify');
exports.createInterface = readline.createInterface;
exports.clearLine = (stream, direction = 0) => stream.write(direction < 0 ? '\x1b[1K' : direction > 0 ? '\x1b[0K' : '\x1b[2K');
