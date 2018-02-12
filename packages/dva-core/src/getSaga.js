/**
 * 该文件的主要作用，就是将用户按照一定格式的输入进行处理，并且使用 redux-saga 进行相关调用
 * 使之起作用
 * **/

import invariant from 'invariant';
import * as sagaEffects from 'redux-saga/effects';
import warning from 'warning';
import {
  takeEveryHelper as takeEvery,
  takeLatestHelper as takeLatest,
  throttleHelper as throttle,
} from 'redux-saga/lib/internal/sagaHelpers';
import { NAMESPACE_SEP } from './constants';
import prefixType from './prefixType';

export default function getSaga(resolve, reject, effects, model, onError, onEffect) {
  return function *() {  // 返回一个函数
    for (const key in effects) {  // 这个函数对 effects 里面的所有键
      if (Object.prototype.hasOwnProperty.call(effects, key)) { // 先判断一下键是属于自己的
        const watcher = getWatcher(resolve, reject, key, effects[key], model, onError, onEffect);
        // 然后调用getWatch获取watcher
        const task = yield sagaEffects.fork(watcher); // 利用 fork 开启一个 task
        yield sagaEffects.fork(function *() { // 这样写的目的是，如果我们移除了这个 model 要及时结束掉
          yield sagaEffects.take(`${model.namespace}/@@CANCEL_EFFECTS`);
          yield sagaEffects.cancel(task);
        });
      }
    }
  };
}

function getWatcher(resolve, reject, key, _effect, model, onError, onEffect) {
  let effect = _effect;
  let type = 'takeEvery';
  let ms;

  if (Array.isArray(_effect)) {
    effect = _effect[0];
    const opts = _effect[1];
    if (opts && opts.type) {
      type = opts.type;
      if (type === 'throttle') {
        invariant(
          opts.ms,
          'app.start: opts.ms should be defined if type is throttle',
        );
        ms = opts.ms;
      }
    }
    invariant(
      ['watcher', 'takeEvery', 'takeLatest', 'throttle'].indexOf(type) > -1,
      'app.start: effect type should be takeEvery, takeLatest, throttle or watcher',
    );
  }

  function *sagaWithCatch(...args) { // 都会调用这个过程
    try {
      yield sagaEffects.put({ type: `${key}${NAMESPACE_SEP}@@start` });
      const ret = yield effect(...args.concat(createEffects(model)));
      yield sagaEffects.put({ type: `${key}${NAMESPACE_SEP}@@end` });
      resolve(key, ret);
    } catch (e) {
      onError(e);
      if (!e._dontReject) {
        reject(key, e);
      }
    }
  }

  const sagaWithOnEffect = applyOnEffect(onEffect, sagaWithCatch, model, key); // 挂载 onEffect 钩子

  switch (type) {
    case 'watcher':
      return sagaWithCatch;
    case 'takeLatest':
      return function*() {
        yield takeLatest(key, sagaWithOnEffect);
      };
    case 'throttle': // 起到节流的效果，在 ms 时间内仅仅会被触发一次
      return function*() {
        yield throttle(ms, key, sagaWithOnEffect);
      };
    default:
      return function*() {
        yield takeEvery(key, sagaWithOnEffect);
      };
  }
}

function createEffects(model) {
  function assertAction(type, name) {
    invariant(type, 'dispatch: action should be a plain Object with type');
    warning(
      type.indexOf(`${model.namespace}${NAMESPACE_SEP}`) !== 0,
      `[${name}] ${type} should not be prefixed with namespace ${model.namespace}`,
    );
  }
  function put(action) {
    const { type } = action;
    assertAction(type, 'sagaEffects.put');
    return sagaEffects.put({ ...action, type: prefixType(type, model) });
  }
  function take(type) {
    if (typeof type === 'string') {
      assertAction(type, 'sagaEffects.take');
      return sagaEffects.take(prefixType(type, model));
    } else {
      return sagaEffects.take(type);
    }
  }
  return { ...sagaEffects, put, take };
}

function applyOnEffect(fns, effect, model, key) {
  for (const fn of fns) {
    effect = fn(effect, sagaEffects, model, key);
  }
  return effect;
}
