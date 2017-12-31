var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

import uuid from './util/uuid.js';
import getBrowserRTC from './util/get-browser-rtc.js';
import ipVersion from './util/ipvx.js';
import EventEmitter from './event-emitter.js';

var MAX_BUFFERED_AMOUNT = 64 * 1024;
var CHROMIUM = typeof window !== 'undefined' && !!window.webkitRTCPeerConnection;

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

var Peer = function (_EventEmitter) {
  _inherits(Peer, _EventEmitter);

  /**
   * Creates a new P2P connection and sets up internal WebRTC events.
   * @param {PeerOptions} opts
   */
  function Peer(opts) {
    _classCallCheck(this, Peer);

    var _this = _possibleConstructorReturn(this, (Peer.__proto__ || Object.getPrototypeOf(Peer)).call(this));

    _this._id = uuid().substr(0, 8);
    // self._debug('new peer %o', opts)

    _this.opts = Object.assign({
      allowHalfOpen: false,
      debug: false
    }, opts);

    _this.channelName = _this.opts.initiator ? _this.opts.channelName || uuid() : null;

    _this.initiator = _this.opts.initiator || false;
    _this.channelConfig = _this.opts.channelConfig || Peer.channelConfig;
    _this.config = _this.opts.config || Peer.config;
    _this.constraints = Peer.transformConstraints(_this.opts.constraints || Peer.constraints);
    _this.offerConstraints = Peer.transformConstraints(_this.opts.offerConstraints || {});
    _this.answerConstraints = Peer.transformConstraints(_this.opts.answerConstraints || {});
    _this.reconnectTimer = _this.opts.reconnectTimer || false;
    _this.sdpTransform = _this.opts.sdpTransform || function (sdp) {
      return sdp;
    };
    _this.stream = _this.opts.stream || false;
    _this.trickle = _this.opts.trickle !== undefined ? _this.opts.trickle : true;
    _this._earlyMessage = null;

    _this.destroyed = false;
    _this.connected = false;

    _this.remoteAddress = undefined;
    _this.remoteFamily = undefined;
    _this.remotePort = undefined;
    _this.localAddress = undefined;
    _this.localPort = undefined;

    _this._wrtc = _this.opts.wrtc && _typeof(_this.opts.wrtc) === 'object' ? _this.opts.wrtc : getBrowserRTC();

    if (!_this._wrtc) {
      throw new Error('No WebRTC support: Not a supported browser');
    }

    _this._pcReady = false;
    _this._channelReady = false;
    _this._iceComplete = false; // ice candidate trickle done (got null candidate)
    _this._channel = null;
    _this._pendingCandidates = [];
    _this._previousStreams = [];

    _this._chunk = null;
    _this._cb = null;
    _this._interval = null;
    _this._reconnectTimeout = null;

    _this._pc = new _this._wrtc.RTCPeerConnection(_this.config, _this.constraints);

    _this._pc.oniceconnectionstatechange = function () {
      _this._onIceStateChange();
    };
    _this._pc.onicegatheringstatechange = function () {
      _this._onIceStateChange();
    };
    _this._pc.onsignalingstatechange = function () {
      _this._onSignalingStateChange();
    };
    _this._pc.onicecandidate = function (event) {
      _this._onIceCandidate(event);
    };

    // Other spec events, unused by this implementation:
    // - onconnectionstatechange
    // - onicecandidateerror
    // - onfingerprintfailure

    if (_this.initiator) {
      var createdOffer = false;
      _this._pc.onnegotiationneeded = function () {
        if (!createdOffer) _this._createOffer();
        createdOffer = true;
      };

      _this._setupData({
        channel: _this._pc.createDataChannel(_this.channelName, _this.channelConfig)
      });
    } else {
      _this._pc.ondatachannel = function (event) {
        _this._setupData(event);
      };
    }

    if ('addTrack' in _this._pc) {
      _this._pc.ontrack = function (event) {
        _this._onTrack(event);
      };
    } else {
      // This can be removed once all browsers support `ontrack`
      // Further reading: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addStream
      _this._pc.onaddstram = function (event) {
        _this._onAddStram(event);
      };
    }
    // HACK: wrtc doesn't fire the 'negotionneeded' event
    if (_this.initiator && _this._isWrtc) {
      _this._pc.onnegotiationneeded();
    }

    _this._onFinishBound = function () {
      _this._onFinish();
    };
    _this.once('finish', _this._onFinishBound);
    return _this;
  } // END CONSTRUCTOR

  /**
   * Default WebRTC config.
   * @constant
   * @type {Object}
   * @default // { iceServers: [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478?transport=udp' } ] }
   */


  _createClass(Peer, [{
    key: 'signal',


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
    value: function signal(data) {
      var _this2 = this;

      if (this.destroyed) throw new Error('cannot signal after peer is destroyed');
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (err) {
          data = {};
        }
      }
      // self._debug('signal()')

      if (data.candidate) {
        if (this._pc.remoteDescription) this._addIceCandidate(data.candidate);else this._pendingCandidates.push(data.candidate);
      }
      if (data.sdp) {
        this._pc.setRemoteDescription(new this._wrtc.RTCSessionDescription(data), function () {
          if (_this2.destroyed) return;

          _this2._pendingCandidates.forEach(function (candidate) {
            return _this2._addIceCandidate(candidate);
          });
          _this2._pendingCandidates = [];

          if (_this2._pc.remoteDescription.type === 'offer') _this2._createAnswer();
        }, function (err) {
          _this2._destroy(err);
        });
      }
      if (!data.sdp && !data.candidate) {
        this._destroy(new Error('signal() called with invalid signal data'));
      }
    }

    /**
    * Send text/binary data to the remote peer.
    * @param {TypedArrayView|ArrayBuffer|Buffer|string|Blob|Object} chunk
    */

  }, {
    key: 'send',
    value: function send(chunk) {
      this._channel.send(chunk);
    }

    /**
     * Destroys the connections and socket.
     * @param {function} onclose On close callback
     */

  }, {
    key: 'destroy',
    value: function destroy(onclose) {
      this._destroy(null, onclose);
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

  }, {
    key: 'getStats',
    value: function getStats(cb) {
      // Promise-based getStats() (standard)
      if (this._pc.getStats.length === 0) {
        this._pc.getStats().then(function (res) {
          var reports = [];
          res.forEach(function (report) {
            reports.push(report);
          });
          cb(null, reports);
        }, function (err) {
          cb(err);
        });

        // Single-parameter callback-based getStats() (non-standard)
      } else if (this._pc.getStats.length > 0) {
        this._pc.getStats(function (res) {
          // If we destroy connection in `connect` callback this code might happen to run when actual connection is already closed
          if (this.destroyed) return;

          var reports = [];
          res.result().forEach(function (result) {
            var report = {};
            result.names().forEach(function (name) {
              report[name] = result.stat(name);
            });
            report.id = result.id;
            report.type = result.type;
            report.timestamp = result.timestamp;
            reports.push(report);
          });
          cb(null, reports);
        }, function (err) {
          cb(err);
        });

        // Unknown browser, skip getStats() since it's anyone's guess which style of
        // getStats() they implement.
      } else {
        cb(null, []);
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

  }, {
    key: '_addIceCandidate',
    value: function _addIceCandidate(candidate) {
      try {
        this._pc.addIceCandidate(new this._wrtc.RTCIceCandidate(candidate), noop, function (err) {
          this._destroy(err);
        });
      } catch (err) {
        this._destroy(new Error('error adding candidate: ' + err.message));
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

  }, {
    key: '_destroy',
    value: function _destroy(err, onclose) {
      if (this.destroyed) return;
      if (onclose) this.once('close', onclose);

      // this._debug('destroy (error: %s)', err && (err.message || err))

      // this.readable = this.writable = false
      //
      // if (!self._readableState.ended) self.push(null)
      // if (!self._writableState.finished) self.end()

      this.destroyed = true;
      this.connected = false;
      this._pcReady = false;
      this._channelReady = false;
      this._previousStreams = null;
      this._earlyMessage = null;

      clearInterval(this._interval);
      clearTimeout(this._reconnectTimeout);
      this._interval = null;
      this._reconnectTimeout = null;
      this._chunk = null;
      this._cb = null;

      if (this._onFinishBound) this.off('finish', this._onFinishBound);
      this._onFinishBound = null;

      if (this._pc) {
        try {
          this._pc.close();
        } catch (err) {}

        this._pc.oniceconnectionstatechange = null;
        this._pc.onicegatheringstatechange = null;
        this._pc.onsignalingstatechange = null;
        this._pc.onicecandidate = null;
        if ('addTrack' in this._pc) {
          this._pc.ontrack = null;
        } else {
          this._pc.onaddstream = null;
        }
        this._pc.onnegotiationneeded = null;
        this._pc.ondatachannel = null;
      }

      if (this._channel) {
        try {
          this._channel.close();
        } catch (err) {}

        this._channel.onmessage = null;
        this._channel.onopen = null;
        this._channel.onclose = null;
        this._channel.onerror = null;
      }
      this._pc = null;
      this._channel = null;

      if (err) this.emit('error', err);
      this.emit('close');
    }

    /**
     * @private
     * Setup a new Data Channel along with the appropriate callbacks
     * @param {Object} event A `[datachannel]{@link https://developer.mozilla.org/en-US/docs/Web/Events/datachannel}`
     *   event with at least a `channel` property.
     */

  }, {
    key: '_setupData',
    value: function _setupData(event) {
      var _this3 = this;

      if (!event.channel) {
        // In some situations `pc.createDataChannel()` returns `undefined` (in wrtc),
        // which is invalid behavior. Handle it gracefully.
        // See: https://github.com/feross/simple-peer/issues/163
        return this._destroy(new Error('Data channel event is missing `channel` property'));
      }

      this._channel = event.channel;
      this._channel.binaryType = 'arraybuffer';

      if (typeof this._channel.bufferedAmountLowThreshold === 'number') {
        this._channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT;
      }

      this.channelName = this._channel.label;

      this._channel.onmessage = function (event) {
        if (!_this3._channelReady) {
          // HACK: Workaround for Chrome not firing "open" between tabs
          _this3._earlyMessage = event;
          _this3._onChannelOpen();
        } else {
          _this3._onChannelMessage(event);
        }
      };
      this._channel.onbufferedamountlow = function () {
        _this3._onChannelBufferedAmountLow();
      };
      this._channel.onopen = function () {
        if (!_this3._channelReady) _this3._onChannelOpen();
      };
      this._channel.onclose = function () {
        _this3._onChannelClose();
      };
      this._channel.onerror = function (err) {
        _this3._destroy(err);
      };
    }

    // FIXME: This is legacy code from simple-peer. Is it needed?

  }, {
    key: '_write',
    value: function _write(chunk, encoding, cb) {
      if (this.destroyed) return cb(new Error('cannot write after peer is destroyed'));

      if (this.connected) {
        try {
          this.send(chunk);
        } catch (err) {
          return this._destroy(err);
        }
        if (this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          // this._debug('start backpressure: bufferedAmount %d', this._channel.bufferedAmount)
          this._cb = cb;
        } else {
          cb(null);
        }
      } else {
        // this._debug('write before connect')
        this._chunk = chunk;
        this._cb = cb;
      }
    }
  }, {
    key: '_createOffer',
    value: function _createOffer() {
      var _this4 = this;

      if (this.destroyed) return;

      this._pc.createOffer(function (offer) {
        var onSuccess = function onSuccess() {
          if (_this4.destroyed) return;
          if (_this4.trickle || _this4._iceComplete) sendOffer();else _this4.once('_iceComplete', sendOffer); // wait for candidates
        };

        var sendOffer = function sendOffer() {
          var signal = _this4._pc.localDescription || offer;
          // this._debug('signal')
          _this4.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          });
        };

        var onError = function onError(err) {
          _this4._destroy(err);
        };

        if (_this4.destroyed) return;
        offer.sdp = _this4.sdpTransform(offer.sdp);
        _this4._pc.setLocalDescription(offer, onSuccess, onError);
      }, function (err) {
        this._destroy(err);
      }, this.offerConstraints);
    }
  }, {
    key: '_createAnswer',
    value: function _createAnswer() {
      var _this5 = this;

      if (this.destroyed) return;

      this._pc.createAnswer(function (answer) {
        var onSuccess = function onSuccess() {
          if (_this5.destroyed) return;
          if (_this5.trickle || _this5._iceComplete) sendAnswer();else _this5.once('_iceComplete', sendAnswer);
        };

        var sendAnswer = function sendAnswer() {
          var signal = _this5._pc.localDescription || answer;
          // this._debug('signal')
          _this5.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          });
        };

        var onError = function onError(err) {
          _this5._destroy(err);
        };

        if (_this5.destroyed) return;
        answer.sdp = _this5.sdpTransform(answer.sdp);
        _this5._pc.setLocalDescription(answer, onSuccess, onError);
      }, function (err) {
        this._destroy(err);
      }, this.answerConstraints);
    }
  }, {
    key: '_onIceStateChange',
    value: function _onIceStateChange() {
      if (this.destroyed) return;
      var iceConnectionState = this._pc.iceConnectionState;
      var iceGatheringState = this._pc.iceGatheringState;

      // this._debug(
      //   'iceStateChange (connection: %s) (gathering: %s)',
      //   iceConnectionState,
      //   iceGatheringState
      // )
      this.emit('iceStateChange', iceConnectionState, iceGatheringState);

      if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
        clearTimeout(this._reconnectTimeout);
        this._pcReady = true;
        this._maybeReady();
      }
      if (iceConnectionState === 'disconnected') {
        if (this.reconnectTimer) {
          // If user has set `opt.reconnectTimer`, allow time for ICE to attempt a reconnect
          clearTimeout(this._reconnectTimeout);
          this._reconnectTimeout = setTimeout(function () {
            this._destroy();
          }, this.reconnectTimer);
        } else {
          this._destroy();
        }
      }
      if (iceConnectionState === 'failed') {
        this._destroy(new Error('Ice connection failed.'));
      }
      if (iceConnectionState === 'closed') {
        this._destroy();
      }
    }
  }, {
    key: '_maybeReady',
    value: function _maybeReady() {
      var _this6 = this;

      // this._debug('maybeReady pc %s channel %s', this._pcReady, this._channelReady)
      if (this.connected || this._connecting || !this._pcReady || !this._channelReady) return;

      this._connecting = true;

      // HACK: We can't rely on order here, for details see https://github.com/js-platform/node-webrtc/issues/339
      var findCandidatePair = function findCandidatePair() {
        if (_this6.destroyed) return;

        _this6.getStats(function (err, items) {
          if (_this6.destroyed) return;

          // Treat getStats error as non-fatal. It's not essential.
          if (err) items = [];

          var remoteCandidates = {};
          var localCandidates = {};
          var candidatePairs = {};
          var foundSelectedCandidatePair = false;

          var setSelectedCandidatePair = function setSelectedCandidatePair(selectedCandidatePair) {
            foundSelectedCandidatePair = true;

            var local = localCandidates[selectedCandidatePair.localCandidateId];

            if (local && local.ip) {
              // Spec
              _this6.localAddress = local.ip;
              _this6.localPort = Number(local.port);
            } else if (local && local.ipAddress) {
              // Firefox
              _this6.localAddress = local.ipAddress;
              _this6.localPort = Number(local.portNumber);
            } else if (typeof selectedCandidatePair.googLocalAddress === 'string') {
              // TODO: remove this once Chrome 58 is released
              local = selectedCandidatePair.googLocalAddress.split(':');
              _this6.localAddress = local[0];
              _this6.localPort = Number(local[1]);
            }

            var remote = remoteCandidates[selectedCandidatePair.remoteCandidateId];

            if (remote && remote.ip) {
              // Spec
              _this6.remoteAddress = remote.ip;
              _this6.remotePort = Number(remote.port);
            } else if (remote && remote.ipAddress) {
              // Firefox
              _this6.remoteAddress = remote.ipAddress;
              _this6.remotePort = Number(remote.portNumber);
            } else if (typeof selectedCandidatePair.googRemoteAddress === 'string') {
              // TODO: remove this once Chrome 58 is released
              remote = selectedCandidatePair.googRemoteAddress.split(':');
              _this6.remoteAddress = remote[0];
              _this6.remotePort = Number(remote[1]);
            }
            _this6.remoteFamily = 'IPv4';

            // this._debug(
            //   'connect local: %s:%s remote: %s:%s',
            //   this.localAddress, this.localPort, this.remoteAddress, this.remotePort
            // )
          };

          items.forEach(function (item) {
            // TODO: Once all browsers support the hyphenated stats report types, remove the non-hypenated ones
            if (item.type === 'remotecandidate' || item.type === 'remote-candidate') {
              remoteCandidates[item.id] = item;
            }
            if (item.type === 'localcandidate' || item.type === 'local-candidate') {
              localCandidates[item.id] = item;
            }
            if (item.type === 'candidatepair' || item.type === 'candidate-pair') {
              candidatePairs[item.id] = item;
            }
          });

          items.forEach(function (item) {
            // Spec-compliant
            if (item.type === 'transport') {
              setSelectedCandidatePair(candidatePairs[item.selectedCandidatePairId]);
            }

            // Old implementations
            if (item.type === 'googCandidatePair' && item.googActiveConnection === 'true' || (item.type === 'candidatepair' || item.type === 'candidate-pair') && item.selected) {
              setSelectedCandidatePair(item);
            }
          });

          if (!foundSelectedCandidatePair && items.length) {
            setTimeout(findCandidatePair, 100);
            return;
          } else {
            _this6._connecting = false;
            _this6.connected = true;
          }

          if (_this6._chunk) {
            try {
              _this6.send(_this6._chunk);
            } catch (err) {
              return _this6._destroy(err);
            }
            _this6._chunk = null;
            // this._debug('sent chunk from "write before connect"')

            var cb = _this6._cb;
            _this6._cb = null;
            cb(null);
          }

          // If `bufferedAmountLowThreshold` and 'onbufferedamountlow' are unsupported,
          // fallback to using setInterval to implement backpressure.
          if (typeof _this6._channel.bufferedAmountLowThreshold !== 'number') {
            _this6._interval = setInterval(_this6._onInterval, 150);
            if (_this6._interval.unref) _this6._interval.unref();
          }

          // this._debug('connect')
          _this6.emit('connect');
          if (_this6._earlyMessage) {
            // HACK: Workaround for Chrome not firing "open" between tabs
            _this6._onChannelMessage(_this6._earlyMessage);
            _this6._earlyMessage = null;
          }
        });
      };
      findCandidatePair();
    }

    // ***** CALLBACKS ***** //

  }, {
    key: '_onFinish',
    value: function _onFinish() {
      if (this.destroyed) return;

      if (this.connected) {
        destroySoon();
      } else {
        this.once('connect', destroySoon);
      }

      // Wait a bit before destroying so the socket flushes.
      // TODO: is there a more reliable way to accomplish this?
      function destroySoon() {
        setTimeout(function () {
          this._destroy();
        }, 1000);
      }
    }
  }, {
    key: '_onInterval',
    value: function _onInterval() {
      if (!this._cb || !this._channel || this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        return;
      }
      this._onChannelBufferedAmountLow();
    }
  }, {
    key: '_onSignalingStateChange',
    value: function _onSignalingStateChange() {
      if (this.destroyed) return;
      // this._debug('signalingStateChange %s', this._pc.signalingState)
      this.emit('signalingStateChange', this._pc.signalingState);
    }
  }, {
    key: '_onIceCandidate',
    value: function _onIceCandidate(event) {
      if (this.destroyed) return;
      if (event.candidate && this.trickle) {
        this.emit('signal', {
          candidate: {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid
          }
        });
      } else if (!event.candidate) {
        this._iceComplete = true;
        this.emit('_iceComplete');
      }
    }
  }, {
    key: '_onChannelMessage',
    value: function _onChannelMessage(event) {
      if (this.destroyed) return;
      var data = event.data;
      if (data instanceof ArrayBuffer) data = Buffer.from(data);
      this.emit('data', data);
    }
  }, {
    key: '_onChannelBufferedAmountLow',
    value: function _onChannelBufferedAmountLow() {
      if (this.destroyed || !this._cb) return;
      // this._debug('ending backpressure: bufferedAmount %d', this._channel.bufferedAmount)
      var cb = this._cb;
      this._cb = null;
      cb(null);
    }
  }, {
    key: '_onChannelOpen',
    value: function _onChannelOpen() {
      var self = this;
      if (self.connected || self.destroyed) return;
      // self._debug('on channel open')
      self._channelReady = true;
      self._maybeReady();
    }
  }, {
    key: '_onChannelClose',
    value: function _onChannelClose() {
      if (this.destroyed) return;
      // this._debug('on channel close')
      this._destroy();
    }
  }, {
    key: '_onTrack',
    value: function _onTrack(event) {
      if (this.destroyed) return;
      this._debug('on track');
      var id = event.streams[0].id;
      if (this._previousStreams.indexOf(id) !== -1) return; // Only fire one 'stream' event, even though there may be multiple tracks per stream
      this._previousStreams.push(id);
      this.emit('stream', event.streams[0]);
    }
  }, {
    key: '_debug',
    value: function _debug(msg) {
      if (this.opts.debug) console.debug(msg);
    }
  }, {
    key: 'bufferSize',


    /**
     * Getter for the `[RTCDataChannel.bufferedAmount]{@link https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount}`
     * property.
     * @type {number}
     * @default 0
     */
    get: function get() {
      return this._channel && this._channel.bufferedAmount || 0;
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

  }, {
    key: 'address',
    get: function get() {
      return {
        port: this.localPort,
        family: ipVersion(this.localAddress),
        address: this.localAddress
      };
    }
  }], [{
    key: 'transformConstraints',


    /**
     * Transform constraints objects into the new format (unless Chromium)
     * TODO: This can be removed when Chromium supports the new format
     */
    value: function transformConstraints(constraints) {
      if (Object.keys(constraints).length === 0) {
        return constraints;
      }

      if ((constraints.mandatory || constraints.optional) && !CHROMIUM) {
        // convert to new format

        // Merge mandatory and optional objects, prioritizing mandatory
        var newConstraints = Object.assign({}, constraints.optional, constraints.mandatory);

        // fix casing
        if (newConstraints.OfferToReceiveVideo !== undefined) {
          newConstraints.offerToReceiveVideo = newConstraints.OfferToReceiveVideo;
          delete newConstraints['OfferToReceiveVideo'];
        }

        if (newConstraints.OfferToReceiveAudio !== undefined) {
          newConstraints.offerToReceiveAudio = newConstraints.OfferToReceiveAudio;
          delete newConstraints['OfferToReceiveAudio'];
        }

        return newConstraints;
      } else if (!constraints.mandatory && !constraints.optional && CHROMIUM) {
        // convert to old format

        // fix casing
        if (constraints.offerToReceiveVideo !== undefined) {
          constraints.OfferToReceiveVideo = constraints.offerToReceiveVideo;
          delete constraints['offerToReceiveVideo'];
        }

        if (constraints.offerToReceiveAudio !== undefined) {
          constraints.OfferToReceiveAudio = constraints.offerToReceiveAudio;
          delete constraints['offerToReceiveAudio'];
        }

        return {
          mandatory: constraints // NOTE: All constraints are upgraded to mandatory
        };
      }

      return constraints;
    }
  }, {
    key: 'config',
    get: function get() {
      return {
        iceServers: [{
          urls: 'stun:stun.l.google.com:19302'
        }, {
          urls: 'stun:global.stun.twilio.com:3478?transport=udp'
        }]
      };
    }

    /**
     * Flag which returns true if the current environment supports WebRTC
     * @constant
     * @type {boolean}
     */

  }, {
    key: 'WEBRTC_SUPPORT',
    get: function get() {
      return !!getBrowserRTC();
    }

    /**
     * @constant
     * @type {Object}
     * @default // {}
     */

  }, {
    key: 'channelConfig',
    get: function get() {
      return {};
    }

    /**
     * @constant
     * @type {Object}
     * @default // {}
     */

  }, {
    key: 'constraints',
    get: function get() {
      return {};
    }
  }]);

  return Peer;
}(EventEmitter);

export default Peer;


function noop() {}