const fs = require('fs')
const browserify = require('browserify')
const run = require('tape-run')

var bundle = browserify()
  .add('./test/index.js')
  .bundle()

var bundleFile = fs.createWriteStream('./test/bundle.js')
bundle.pipe(bundleFile)

console.log('Open http://localhost:5664 to run tests!')
bundle.pipe(run({port: 5664, keepOpen: true}))
