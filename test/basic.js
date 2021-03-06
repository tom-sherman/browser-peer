var Peer = require('../lib/peer.js').default
var test = require('tape')

window.Peer = Peer

test('detect WebRTC support', function (t) {
  t.equal(Peer.WEBRTC_SUPPORT, typeof window !== 'undefined', 'builtin webrtc support')
  t.end()
})

test('create peer without options', function (t) {
  t.plan(1)

  if (process.browser) {
    var peer
    t.doesNotThrow(function () {
      peer = new Peer()
      peer.destroy()
    })
  } else {
    t.pass('Skip no-option test in Node.js, since the wrtc option is required')
  }
})

test('signal event gets emitted', function (t) {
  t.plan(2)

  var peer = new Peer({ initiator: true })
  peer.once('signal', function () {
    t.pass('got signal event')
    peer.destroy(function () { t.pass('peer destroyed') })
  })
})

test('data send/receive text', function (t) {
  t.plan(16)

  var peer1 = new Peer({ initiator: true })
  var peer2 = new Peer()

  var numSignal1 = 0
  peer1.on('signal', function (data) {
    numSignal1 += 1
    peer2.signal(data)
  })

  var numSignal2 = 0
  peer2.on('signal', function (data) {
    numSignal2 += 1
    peer1.signal(data)
  })

  peer1.on('connect', tryTest)
  peer2.on('connect', tryTest)

  function tryTest () {
    if (!peer1.connected || !peer2.connected) return

    t.ok(numSignal1 >= 1)
    t.ok(numSignal2 >= 1)
    t.equal(peer1.initiator, true, 'peer1 is initiator')
    t.equal(peer2.initiator, false, 'peer2 is not initiator')

    t.equal(typeof peer1.localAddress, 'string')
    t.equal(typeof peer1.localPort, 'number')
    t.equal(typeof peer2.localAddress, 'string')
    t.equal(typeof peer2.localPort, 'number')

    t.ok(typeof peer1.remoteFamily === 'string')
    t.ok(peer1.remoteFamily.indexOf('IPv') === 0)
    t.ok(typeof peer2.remoteFamily === 'string')
    t.ok(peer2.remoteFamily.indexOf('IPv') === 0)

    peer1.send('sup peer2')
    peer2.on('data', function (data) {
      // t.ok(Buffer.isBuffer(data), 'data is Buffer')
      t.equal(data.toString(), 'sup peer2', 'got correct message')

      peer2.send('sup peer1')
      peer1.on('data', function (data) {
        // t.ok(Buffer.isBuffer(data), 'data is Buffer')
        t.equal(data.toString(), 'sup peer1', 'got correct message')

        peer1.destroy(function () { t.pass('peer1 destroyed') })
        peer2.destroy(function () { t.pass('peer2 destroyed') })
      })
    })
  }
})

test('sdpTransform function is called', function (t) {
  t.plan(3)

  var peer1 = new Peer({ initiator: true })
  var peer2 = new Peer({ sdpTransform: sdpTransform })

  function sdpTransform (sdp) {
    t.equal(typeof sdp, 'string', 'got a string as SDP')
    setTimeout(function () {
      peer1.destroy(function () { t.pass('peer1 destroyed') })
      peer2.destroy(function () { t.pass('peer2 destroyed') })
    }, 0)
    return sdp
  }

  peer1.on('signal', function (data) {
    peer2.signal(data)
  })

  peer2.on('signal', function (data) {
    peer1.signal(data)
  })
})

test('old constraint formats are used', function (t) {
  t.plan(3)

  var constraints = {
    mandatory: {
      OfferToReceiveAudio: true,
      OfferToReceiveVideo: true
    }
  }

  var peer1 = new Peer({ initiator: true, constraints: constraints })
  var peer2 = new Peer({ constraints: constraints })

  peer1.on('signal', function (data) {
    peer2.signal(data)
  })

  peer2.on('signal', function (data) {
    peer1.signal(data)
  })

  peer1.on('connect', function () {
    t.pass('peers connected')
    peer1.destroy(function () { t.pass('peer1 destroyed') })
    peer2.destroy(function () { t.pass('peer2 destroyed') })
  })
})

test('new constraint formats are used', function (t) {
  t.plan(3)

  var constraints = {
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  }

  var peer1 = new Peer({ initiator: true, constraints: constraints })
  var peer2 = new Peer({ constraints: constraints })

  peer1.on('signal', function (data) {
    peer2.signal(data)
  })

  peer2.on('signal', function (data) {
    peer1.signal(data)
  })

  peer1.on('connect', function () {
    t.pass('peers connected')
    peer1.destroy(function () { t.pass('peer1 destroyed') })
    peer2.destroy(function () { t.pass('peer2 destroyed') })
  })
})

test('ensure remote address and port are available right after connection', function (t) {
  t.plan(7)

  var peer1 = new Peer({ initiator: true })
  var peer2 = new Peer()

  peer1.on('signal', function (data) {
    peer2.signal(data)
  })

  peer2.on('signal', function (data) {
    peer1.signal(data)
  })

  peer1.on('connect', function () {
    t.pass('peers connected')

    t.ok(peer1.remoteAddress, 'peer1 remote address is present')
    t.ok(peer1.remotePort, 'peer1 remote port is present')

    peer2.on('connect', function () {
      t.ok(peer2.remoteAddress, 'peer2 remote address is present')
      t.ok(peer2.remotePort, 'peer2 remote port is present')

      peer1.destroy(function () { t.pass('peer1 destroyed') })
      peer2.destroy(function () { t.pass('peer2 destroyed') })
    })
  })
})
