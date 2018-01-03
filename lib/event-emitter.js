'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _isType = require('./util/is-type.js');

// TODO: Strip out into own module

/** Emulates Node.js event pub/sub pattern */
var EventEmitter = function () {
  function EventEmitter() {
    babelHelpers.classCallCheck(this, EventEmitter);

    this._eventMap = new Map();
  }

  babelHelpers.createClass(EventEmitter, [{
    key: 'addListener',
    value: function addListener(labelString, callback) {
      var _this = this;

      if (!(0, _isType.isFunction)(callback)) throw new TypeError('listener must be a function');
      var labels = labelString.split(' ');

      labels.forEach(function (label) {
        if (!_this._eventMap.has(label)) _this._eventMap.set(label, []);
        _this.listeners(label).push(callback);
      });

      return this;
    }
  }, {
    key: 'on',
    value: function on() {
      return this.addListener.apply(this, arguments);
    }
  }, {
    key: 'once',
    value: function once(label, callback) {
      if (!(0, _isType.isFunction)(callback)) throw new TypeError('listener must be a function');

      var fired = false;

      function g() {
        this.removeListener(label, g);

        if (!fired) {
          fired = true;
          callback.apply(this, arguments);
        }
      }

      g.callback = callback;
      this.on(label, g);

      return this;
    }
  }, {
    key: 'removeListener',
    value: function removeListener(label, callback) {
      if (!(0, _isType.isFunction)(callback)) throw new TypeError('listener must be a function');

      var currentListeners = this.listeners(label);
      var newListeners = currentListeners.filter(function (listener) {
        return listener !== callback;
      });

      if (currentListeners !== newListeners) {
        this._eventMap.set(label, newListeners);
        return this;
      }
    }
  }, {
    key: 'off',
    value: function off() {
      return this.removeListener.apply(this, arguments);
    }
  }, {
    key: 'removeAllListeners',
    value: function removeAllListeners(type) {
      return this._eventMap.delete(type);
    }
  }, {
    key: 'emit',
    value: function emit(label) {
      var _this2 = this;

      for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      var listeners = this.listeners(label);

      if (listeners && listeners.length) {
        listeners.forEach(function (listener) {
          return listener.apply(_this2, args);
        });
        return this;
      }
    }
  }, {
    key: 'listeners',
    value: function listeners(type) {
      return this._eventMap.get(type);
    }
  }], [{
    key: 'listenerCount',
    value: function listenerCount(emitter, type) {
      return emitter.listenerCount(type);
    }
  }]);
  return EventEmitter;
}();

exports.default = EventEmitter;