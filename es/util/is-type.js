var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

export function isFunction(arg) {
  return typeof arg === 'function';
}

export function isNumber(arg) {
  return typeof arg === 'number';
}

export function isObject(arg) {
  return (typeof arg === 'undefined' ? 'undefined' : _typeof(arg)) === 'object' && arg !== null;
}

export function isUndefined(arg) {
  return arg === void 0;
}