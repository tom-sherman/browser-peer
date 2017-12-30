import {isFunction} from './util/is-type.js'

// TODO: Strip out into own module

/** Emulates Node.js event pub/sub pattern */
export default class EventEmitter {
  constructor () {
    this._eventMap = new Map()
  }

  addListener (labelString, callback) {
    if (!isFunction(callback)) throw new TypeError('listener must be a function')
    let labels = labelString.split(' ')

    labels.forEach(label => {
      if (!this._eventMap.has(label)) this._eventMap.set(label, [])
      this.listeners(label).push(callback)
    })

    return this
  }
  on () { return this.addListener(...arguments) }

  once (label, callback) {
    if (!isFunction(callback)) throw new TypeError('listener must be a function')

    var fired = false

    function g () {
      this.removeListener(label, g)

      if (!fired) {
        fired = true
        callback.apply(this, arguments)
      }
    }

    g.callback = callback
    this.on(label, g)

    return this
  }

  removeListener (label, callback) {
    if (!isFunction(callback)) throw new TypeError('listener must be a function')

    let currentListeners = this.listeners(label)
    let newListeners = currentListeners.filter(listener => listener !== callback)

    if (currentListeners !== newListeners) {
      this._eventMap.set(label, newListeners)
      return this
    }
  }
  off () { return this.removeListener(...arguments) }

  removeAllListeners (type) {
    return this._eventMap.delete(type)
  }

  emit (label, ...args) {
    let listeners = this.listeners(label)

    if (listeners && listeners.length) {
      listeners.forEach(listener => listener.apply(this, args))
      return this
    }
  }

  listeners (type) {
    return this._eventMap.get(type)
  }

  static listenerCount (emitter, type) {
    return emitter.listenerCount(type)
  }
}
