import uuid from './util/uuid.js'
import getBrowserRTC from './util/get-browser-rtc.js'
import ipVersion from './util/ipvx.js'
import EventEmitter from './event-emitter.js'

const MAX_BUFFERED_AMOUNT = 64 * 1024
const CHROMIUM = typeof window !== 'undefined' && !!window.webkitRTCPeerConnection

/**
 * @typedef PeerOptions
 * @type {Object}
 * @property {boolean} initiator Set to true if this local peer is the initiator
 *   of the connection.
 * @property {boolean} [allowHalfOpen=false]
 * @property {boolean} [debug=false] Set to true to log debug messages.
 */

/**
 * Represents a P2P connection.
 * @extends EventEmitter
 */
export default class Peer extends EventEmitter {
  /**
   * Creates a new P2P connection and sets up internal WebRTC events.
   * @param {PeerOptions} opts
   */
  constructor (opts) {
    super()
    this._id = uuid().substr(0, 8)
    // self._debug('new peer %o', opts)

    this.opts = Object.assign({
      allowHalfOpen: false,
      debug: false
    }, opts)

    this.channelName = this.opts.initiator
      ? this.opts.channelName || uuid()
      : null

    this.initiator = this.opts.initiator || false
    this.channelConfig = this.opts.channelConfig || Peer.channelConfig
    this.config = this.opts.config || Peer.config
    this.constraints = Peer.transformConstraints(this.opts.constraints || Peer.constraints)
    this.offerConstraints = Peer.transformConstraints(this.opts.offerConstraints || {})
    this.answerConstraints = Peer.transformConstraints(this.opts.answerConstraints || {})
    this.reconnectTimer = this.opts.reconnectTimer || false
    this.sdpTransform = this.opts.sdpTransform || function (sdp) { return sdp }
    this.stream = this.opts.stream || false
    this.trickle = this.opts.trickle !== undefined ? this.opts.trickle : true
    this._earlyMessage = null

    this.destroyed = false
    this.connected = false

    this.remoteAddress = undefined
    this.remoteFamily = undefined
    this.remotePort = undefined
    this.localAddress = undefined
    this.localPort = undefined

    this._wrtc = (this.opts.wrtc && typeof this.opts.wrtc === 'object')
      ? this.opts.wrtc
      : getBrowserRTC()

    if (!this._wrtc) {
      throw new Error('No WebRTC support: Not a supported browser')
    }

    this._pcReady = false
    this._channelReady = false
    this._iceComplete = false // ice candidate trickle done (got null candidate)
    this._channel = null
    this._pendingCandidates = []
    this._previousStreams = []

    this._chunk = null
    this._cb = null
    this._interval = null
    this._reconnectTimeout = null

    this._pc = new (this._wrtc.RTCPeerConnection)(this.config, this.constraints)

    this._pc.oniceconnectionstatechange = () => {
      this._onIceStateChange()
    }
    this._pc.onicegatheringstatechange = () => {
      this._onIceStateChange()
    }
    this._pc.onsignalingstatechange = () => {
      this._onSignalingStateChange()
    }
    this._pc.onicecandidate = (event) => {
      this._onIceCandidate(event)
    }

    // Other spec events, unused by this implementation:
    // - onconnectionstatechange
    // - onicecandidateerror
    // - onfingerprintfailure

    if (this.initiator) {
      let createdOffer = false
      this._pc.onnegotiationneeded = () => {
        if (!createdOffer) this._createOffer()
        createdOffer = true
      }

      this._setupData({
        channel: this._pc.createDataChannel(this.channelName, this.channelConfig)
      })
    } else {
      this._pc.ondatachannel = (event) => {
        this._setupData(event)
      }
    }

    if ('addTrack' in this._pc) {
      this._pc.ontrack = (event) => {
        this._onTrack(event)
      }
    } else {
      // This can be removed once all browsers support `ontrack`
      // Further reading: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addStream
      this._pc.onaddstram = (event) => {
        this._onAddStram(event)
      }
    }
    // HACK: wrtc doesn't fire the 'negotionneeded' event
    if (this.initiator && this._isWrtc) {
      this._pc.onnegotiationneeded()
    }

    this._onFinishBound = () => {
      this._onFinish()
    }
    this.once('finish', this._onFinishBound)
  } // END CONSTRUCTOR

  /**
   * Default WebRTC config.
   * @constant
   * @type {Object}
   * @default // { iceServers: [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478?transport=udp' } ] }
   */
  static get config () {
    return {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        },
        {
          urls: 'stun:global.stun.twilio.com:3478?transport=udp'
        }
      ]
    }
  }

  /**
   * Flag which returns true if the current environment supports WebRTC
   * @constant
   * @type {boolean}
   */
  static get WEBRTC_SUPPORT () {
    return !!getBrowserRTC()
  }

  /**
   * @constant
   * @type {Object}
   * @default // {}
   */
  static get channelConfig () { return {} }

  /**
   * @constant
   * @type {Object}
   * @default // {}
   */
  static get constraints () { return {} }

  /**
   * Transform constraints objects into the new format (unless Chromium)
   * TODO: This can be removed when Chromium supports the new format
   */
  static transformConstraints (constraints) {
    if (Object.keys(constraints).length === 0) {
      return constraints
    }

    if ((constraints.mandatory || constraints.optional) && !CHROMIUM) {
      // convert to new format

      // Merge mandatory and optional objects, prioritizing mandatory
      var newConstraints = Object.assign({}, constraints.optional, constraints.mandatory)

      // fix casing
      if (newConstraints.OfferToReceiveVideo !== undefined) {
        newConstraints.offerToReceiveVideo = newConstraints.OfferToReceiveVideo
        delete newConstraints['OfferToReceiveVideo']
      }

      if (newConstraints.OfferToReceiveAudio !== undefined) {
        newConstraints.offerToReceiveAudio = newConstraints.OfferToReceiveAudio
        delete newConstraints['OfferToReceiveAudio']
      }

      return newConstraints
    } else if (!constraints.mandatory && !constraints.optional && CHROMIUM) {
      // convert to old format

      // fix casing
      if (constraints.offerToReceiveVideo !== undefined) {
        constraints.OfferToReceiveVideo = constraints.offerToReceiveVideo
        delete constraints['offerToReceiveVideo']
      }

      if (constraints.offerToReceiveAudio !== undefined) {
        constraints.OfferToReceiveAudio = constraints.offerToReceiveAudio
        delete constraints['offerToReceiveAudio']
      }

      return {
        mandatory: constraints // NOTE: All constraints are upgraded to mandatory
      }
    }

    return constraints
  }

  /**
   * Getter for the `[RTCDataChannel.bufferedAmount]{@link https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount}`
   * property.
   * @type {number}
   * @default 0
   */
  get bufferSize () {
    return (this._channel && this._channel.bufferedAmount) || 0
  }

  /**
   * @typedef {Object} PeerAddress
   * @property {number} port
   * @property {string} family
   * @property {string} address
   */

  /**
   * Returns the local `PeerAddress`
   * @type {PeerAddress}
   */
  get address () {
    return {
      port: this.localPort,
      family: ipVersion(this.localAddress),
      address: this.localAddress
    }
  }

  /**
   * `[RTCSessionDescription]{@link https://developer.mozilla.org/en-US/docs/Web/API/RTCSessionDescription}`
   * @typedef RTCSessionDescription
   * @type {Object}
   */

  /**
   * The signal method attempts to setup the P2P connection using the proposed
   * candidates.
   * @param {RTCSessionDescription} data The signalling data
   */
  signal (data) {
    if (this.destroyed) throw new Error('cannot signal after peer is destroyed')
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (err) {
        data = {}
      }
    }
    // self._debug('signal()')

    if (data.candidate) {
      if (this._pc.remoteDescription) this._addIceCandidate(data.candidate)
      else this._pendingCandidates.push(data.candidate)
    }
    if (data.sdp) {
      this._pc.setRemoteDescription(new (this._wrtc.RTCSessionDescription)(data), () => {
        if (this.destroyed) return

        this._pendingCandidates.forEach(candidate => this._addIceCandidate(candidate))
        this._pendingCandidates = []

        if (this._pc.remoteDescription.type === 'offer') this._createAnswer()
      }, (err) => { this._destroy(err) })
    }
    if (!data.sdp && !data.candidate) {
      this._destroy(new Error('signal() called with invalid signal data'))
    }
  }

  /**
  * Send text/binary data to the remote peer.
  * @param {TypedArrayView|ArrayBuffer|Buffer|string|Blob|Object} chunk
  */
  send (chunk) {
    this._channel.send(chunk)
  }

  /**
   * Destroys the connections and socket.
   * @param {function} onclose On close callback
   */
  destroy (onclose) {
    this._destroy(null, onclose)
  }

  /**
   * @callback getStatsCallback
   * @param {?Error} err
   * @param {Array} reports
   */

  /**
   * Wraps the promise based `RTCRtpSender.getStats()` method in a callback
   * based approach.
   * @param {getStatsCallback} cb Callback that handles the response
   */
  getStats (cb) {
    // Promise-based getStats() (standard)
    if (this._pc.getStats.length === 0) {
      this._pc.getStats().then(function (res) {
        var reports = []
        res.forEach(function (report) {
          reports.push(report)
        })
        cb(null, reports)
      }, function (err) { cb(err) })

      // Single-parameter callback-based getStats() (non-standard)
    } else if (this._pc.getStats.length > 0) {
      this._pc.getStats(function (res) {
        // If we destroy connection in `connect` callback this code might happen to run when actual connection is already closed
        if (this.destroyed) return

        var reports = []
        res.result().forEach(function (result) {
          var report = {}
          result.names().forEach(function (name) {
            report[name] = result.stat(name)
          })
          report.id = result.id
          report.type = result.type
          report.timestamp = result.timestamp
          reports.push(report)
        })
        cb(null, reports)
      }, function (err) { cb(err) })

      // Unknown browser, skip getStats() since it's anyone's guess which style of
      // getStats() they implement.
    } else {
      cb(null, [])
    }
  }

  // ***** PRIVATE METHODS ***** //

  /**
   * @private
   * A wrapper for the `[RTCPeerConnection.addIceCandidate()]{@link https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate}`
   * method.
   * @param {Object} candidate An object conforming to the RTCIceCandidateInit
   *  dictionary.
   */
  _addIceCandidate (candidate) {
    try {
      this._pc.addIceCandidate(
        new this._wrtc.RTCIceCandidate(candidate),
        noop,
        function (err) { this._destroy(err) }
      )
    } catch (err) {
      this._destroy(new Error('error adding candidate: ' + err.message))
    }
  }

  /**
   * @private
   * Method which destroys the socket and connection when an error occurs.
   * Can be called using the public method `Peer.destroy()`. Catch these errors
   * by creating a `Peer.on('error', handler)` event handler.
   * @param {?Error} err The error that occured.
   * @param {function} onclose On close callback
   */
  _destroy (err, onclose) {
    if (this.destroyed) return
    if (onclose) this.once('close', onclose)

    this._debug('destroy (error: %s)', err && (err.message || err))

    // this.readable = this.writable = false
    //
    // if (!self._readableState.ended) self.push(null)
    // if (!self._writableState.finished) self.end()

    this.destroyed = true
    this.connected = false
    this._pcReady = false
    this._channelReady = false
    this._previousStreams = null
    this._earlyMessage = null

    clearInterval(this._interval)
    clearTimeout(this._reconnectTimeout)
    this._interval = null
    this._reconnectTimeout = null
    this._chunk = null
    this._cb = null

    if (this._onFinishBound) this.off('finish', this._onFinishBound)
    this._onFinishBound = null

    if (this._pc) {
      try {
        this._pc.close()
      } catch (err) {}

      this._pc.oniceconnectionstatechange = null
      this._pc.onicegatheringstatechange = null
      this._pc.onsignalingstatechange = null
      this._pc.onicecandidate = null
      if ('addTrack' in this._pc) {
        this._pc.ontrack = null
      } else {
        this._pc.onaddstream = null
      }
      this._pc.onnegotiationneeded = null
      this._pc.ondatachannel = null
    }

    if (this._channel) {
      try {
        this._channel.close()
      } catch (err) {}

      this._channel.onmessage = null
      this._channel.onopen = null
      this._channel.onclose = null
      this._channel.onerror = null
    }
    this._pc = null
    this._channel = null

    if (err) this.emit('error', err)
    this.emit('close')
  }

  /**
   * @private
   * Setup a new Data Channel along with the appropriate callbacks
   * @param {Object} event A `[datachannel]{@link https://developer.mozilla.org/en-US/docs/Web/Events/datachannel}`
   *   event with at least a `channel` property.
   */
  _setupData (event) {
    if (!event.channel) {
      // In some situations `pc.createDataChannel()` returns `undefined` (in wrtc),
      // which is invalid behavior. Handle it gracefully.
      // See: https://github.com/feross/simple-peer/issues/163
      return this._destroy(new Error('Data channel event is missing `channel` property'))
    }

    this._channel = event.channel
    this._channel.binaryType = 'arraybuffer'

    if (typeof this._channel.bufferedAmountLowThreshold === 'number') {
      this._channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT
    }

    this.channelName = this._channel.label

    this._channel.onmessage = (event) => {
      if (!this._channelReady) { // HACK: Workaround for Chrome not firing "open" between tabs
        this._earlyMessage = event
        this._onChannelOpen()
      } else {
        this._onChannelMessage(event)
      }
    }
    this._channel.onbufferedamountlow = () => {
      this._onChannelBufferedAmountLow()
    }
    this._channel.onopen = () => {
      if (!this._channelReady) this._onChannelOpen()
    }
    this._channel.onclose = () => {
      this._onChannelClose()
    }
    this._channel.onerror = (err) => {
      this._destroy(err)
    }
  }

  // FIXME: This is legacy code from simple-peer. Is it needed?
  _write (chunk, encoding, cb) {
    if (this.destroyed) return cb(new Error('cannot write after peer is destroyed'))

    if (this.connected) {
      try {
        this.send(chunk)
      } catch (err) {
        return this._destroy(err)
      }
      if (this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        this._debug('start backpressure: bufferedAmount %d', this._channel.bufferedAmount)
        this._cb = cb
      } else {
        cb(null)
      }
    } else {
      this._debug('write before connect')
      this._chunk = chunk
      this._cb = cb
    }
  }

  _createOffer () {
    if (this.destroyed) return

    this._pc.createOffer((offer) => {
      var onSuccess = () => {
        if (this.destroyed) return
        if (this.trickle || this._iceComplete) sendOffer()
        else this.once('_iceComplete', sendOffer) // wait for candidates
      }

      var sendOffer = () => {
        var signal = this._pc.localDescription || offer
        this._debug('signal')
        this.emit('signal', {
          type: signal.type,
          sdp: signal.sdp
        })
      }

      var onError = (err) => {
        this._destroy(err)
      }

      if (this.destroyed) return
      offer.sdp = this.sdpTransform(offer.sdp)
      this._pc.setLocalDescription(offer, onSuccess, onError)
    }, function (err) { this._destroy(err) }, this.offerConstraints)
  }

  _createAnswer () {
    if (this.destroyed) return

    this._pc.createAnswer((answer) => {
      var onSuccess = () => {
        if (this.destroyed) return
        if (this.trickle || this._iceComplete) sendAnswer()
        else this.once('_iceComplete', sendAnswer)
      }

      var sendAnswer = () => {
        var signal = this._pc.localDescription || answer
        this._debug('signal')
        this.emit('signal', {
          type: signal.type,
          sdp: signal.sdp
        })
      }

      var onError = (err) => {
        this._destroy(err)
      }

      if (this.destroyed) return
      answer.sdp = this.sdpTransform(answer.sdp)
      this._pc.setLocalDescription(answer, onSuccess, onError)
    }, function (err) { this._destroy(err) }, this.answerConstraints)
  }

  _onIceStateChange () {
    if (this.destroyed) return
    var iceConnectionState = this._pc.iceConnectionState
    var iceGatheringState = this._pc.iceGatheringState

    this._debug(
      'iceStateChange (connection: %s) (gathering: %s)',
      iceConnectionState,
      iceGatheringState
    )
    this.emit('iceStateChange', iceConnectionState, iceGatheringState)

    if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
      clearTimeout(this._reconnectTimeout)
      this._pcReady = true
      this._maybeReady()
    }
    if (iceConnectionState === 'disconnected') {
      if (this.reconnectTimer) {
        // If user has set `opt.reconnectTimer`, allow time for ICE to attempt a reconnect
        clearTimeout(this._reconnectTimeout)
        this._reconnectTimeout = setTimeout(function () {
          this._destroy()
        }, this.reconnectTimer)
      } else {
        this._destroy()
      }
    }
    if (iceConnectionState === 'failed') {
      this._destroy(new Error('Ice connection failed.'))
    }
    if (iceConnectionState === 'closed') {
      this._destroy()
    }
  }

  _maybeReady () {
    this._debug('maybeReady pc %s channel %s', this._pcReady, this._channelReady)
    if (this.connected || this._connecting || !this._pcReady || !this._channelReady) return

    this._connecting = true

    // HACK: We can't rely on order here, for details see https://github.com/js-platform/node-webrtc/issues/339
    var findCandidatePair = () => {
      if (this.destroyed) return

      this.getStats((err, items) => {
        if (this.destroyed) return

        // Treat getStats error as non-fatal. It's not essential.
        if (err) items = []

        var remoteCandidates = {}
        var localCandidates = {}
        var candidatePairs = {}
        var foundSelectedCandidatePair = false

        var setSelectedCandidatePair = (selectedCandidatePair) => {
          foundSelectedCandidatePair = true

          var local = localCandidates[selectedCandidatePair.localCandidateId]

          if (local && local.ip) {
            // Spec
            this.localAddress = local.ip
            this.localPort = Number(local.port)
          } else if (local && local.ipAddress) {
            // Firefox
            this.localAddress = local.ipAddress
            this.localPort = Number(local.portNumber)
          } else if (typeof selectedCandidatePair.googLocalAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            local = selectedCandidatePair.googLocalAddress.split(':')
            this.localAddress = local[0]
            this.localPort = Number(local[1])
          }

          var remote = remoteCandidates[selectedCandidatePair.remoteCandidateId]

          if (remote && remote.ip) {
            // Spec
            this.remoteAddress = remote.ip
            this.remotePort = Number(remote.port)
          } else if (remote && remote.ipAddress) {
            // Firefox
            this.remoteAddress = remote.ipAddress
            this.remotePort = Number(remote.portNumber)
          } else if (typeof selectedCandidatePair.googRemoteAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            remote = selectedCandidatePair.googRemoteAddress.split(':')
            this.remoteAddress = remote[0]
            this.remotePort = Number(remote[1])
          }
          this.remoteFamily = 'IPv4'

          this._debug(
            'connect local: %s:%s remote: %s:%s',
            this.localAddress, this.localPort, this.remoteAddress, this.remotePort
          )
        }

        items.forEach(function (item) {
          // TODO: Once all browsers support the hyphenated stats report types, remove the non-hypenated ones
          if (item.type === 'remotecandidate' || item.type === 'remote-candidate') {
            remoteCandidates[item.id] = item
          }
          if (item.type === 'localcandidate' || item.type === 'local-candidate') {
            localCandidates[item.id] = item
          }
          if (item.type === 'candidatepair' || item.type === 'candidate-pair') {
            candidatePairs[item.id] = item
          }
        })

        items.forEach(function (item) {
          // Spec-compliant
          if (item.type === 'transport') {
            setSelectedCandidatePair(candidatePairs[item.selectedCandidatePairId])
          }

          // Old implementations
          if (
            (item.type === 'googCandidatePair' && item.googActiveConnection === 'true') ||
            ((item.type === 'candidatepair' || item.type === 'candidate-pair') && item.selected)
          ) {
            setSelectedCandidatePair(item)
          }
        })

        if (!foundSelectedCandidatePair && items.length) {
          setTimeout(findCandidatePair, 100)
          return
        } else {
          this._connecting = false
          this.connected = true
        }

        if (this._chunk) {
          try {
            this.send(this._chunk)
          } catch (err) {
            return this._destroy(err)
          }
          this._chunk = null
          this._debug('sent chunk from "write before connect"')

          var cb = this._cb
          this._cb = null
          cb(null)
        }

        // If `bufferedAmountLowThreshold` and 'onbufferedamountlow' are unsupported,
        // fallback to using setInterval to implement backpressure.
        if (typeof this._channel.bufferedAmountLowThreshold !== 'number') {
          this._interval = setInterval(this._onInterval, 150)
          if (this._interval.unref) this._interval.unref()
        }

        this._debug('connect')
        this.emit('connect')
        if (this._earlyMessage) { // HACK: Workaround for Chrome not firing "open" between tabs
          this._onChannelMessage(this._earlyMessage)
          this._earlyMessage = null
        }
      })
    }
    findCandidatePair()
  }

  // ***** CALLBACKS ***** //

  _onFinish () {
    if (this.destroyed) return

    if (this.connected) {
      destroySoon()
    } else {
      this.once('connect', destroySoon)
    }

    // Wait a bit before destroying so the socket flushes.
    // TODO: is there a more reliable way to accomplish this?
    function destroySoon () {
      setTimeout(function () {
        this._destroy()
      }, 1000)
    }
  }

  _onInterval () {
    if (!this._cb || !this._channel || this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      return
    }
    this._onChannelBufferedAmountLow()
  }

  _onSignalingStateChange () {
    if (this.destroyed) return
    this._debug('signalingStateChange %s', this._pc.signalingState)
    this.emit('signalingStateChange', this._pc.signalingState)
  }

  _onIceCandidate (event) {
    if (this.destroyed) return
    if (event.candidate && this.trickle) {
      this.emit('signal', {
        candidate: {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid
        }
      })
    } else if (!event.candidate) {
      this._iceComplete = true
      this.emit('_iceComplete')
    }
  }

  _onChannelMessage (event) {
    if (this.destroyed) return
    var data = event.data
    if (data instanceof ArrayBuffer) data = Buffer.from(data)
    this.emit('data', data)
  }

  _onChannelBufferedAmountLow () {
    if (this.destroyed || !this._cb) return
    this._debug('ending backpressure: bufferedAmount %d', this._channel.bufferedAmount)
    var cb = this._cb
    this._cb = null
    cb(null)
  }

  _onChannelOpen () {
    var self = this
    if (self.connected || self.destroyed) return
    // self._debug('on channel open')
    self._channelReady = true
    self._maybeReady()
  }

  _onChannelClose () {
    if (this.destroyed) return
    this._debug('on channel close')
    this._destroy()
  }

  _onTrack (event) {
    if (this.destroyed) return
    this._debug('on track')
    var id = event.streams[0].id
    if (this._previousStreams.indexOf(id) !== -1) return // Only fire one 'stream' event, even though there may be multiple tracks per stream
    this._previousStreams.push(id)
    this.emit('stream', event.streams[0])
  }

  _debug (msg) { if (this.opts.debug) console.debug(msg) }
}

function noop () {}
