// This file is needed as for some reason it isn't possible to pass a glob
// into browserify on Windows.

// Browserify this file and pass it into `tape-run` to test.

require('./basic.js')
require('./binary.js')
require('./object-mode.js')
require('./stream')
require('./trickle.js')
