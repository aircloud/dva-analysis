import { combineReducers } from 'redux';
import createSagaMiddleware from 'redux-saga/lib/internal/middleware';
import invariant from 'invariant';
import checkModel from './checkModel';
import prefixNamespace from './prefixNamespace';
import Plugin, { filterHooks } from './Plugin';
import createStore from './createStore';
import getSaga from './getSaga';
import getReducer from './getReducer';
import createPromiseMiddleware from './createPromiseMiddleware';
import {
  run as runSubscription,
  unlisten as unlistenSubscription,
} from './subscription';
import { noop } from './utils';

// Internal model to update global state when do unmodel
const dvaModel = {
  namespace: '@@dva',
  state: 0,
  reducers: {
    UPDATE(state) { return state + 1; },
  },
};

/**
 * Create dva-core instance.
 *
 * @param hooksAndOpts
 * @param createOpts
 */
export function create(hooksAndOpts = {}, createOpts = {}) {
  const {
    initialReducer,
    setupApp = noop,
  } = createOpts;

  const plugin = new Plugin(); // 实例化钩子函数管理类
  plugin.use(filterHooks(hooksAndOpts)); // 这个时候先对 obj 进行清理，清理出在我们定义的类型之外的 hooks，之后进行统一绑定

  const app = {
    _models: [
      prefixNamespace({ ...dvaModel }), // 前缀处理
    ],
    _store: null,
    _plugin: plugin,
    use: plugin.use.bind(plugin),
    model, // 下文定义
    start, // 下文定义
  };
  return app;

  // 在这里, 实际上主流程已经走完, app 已经返回了

  /**
   * Register model before app is started.
   *
   * @param m {Object} model to register
   */
  function model(m) {
    if (process.env.NODE_ENV !== 'production') {
      checkModel(m, app._models);
    }
    app._models.push(prefixNamespace(m));
    // 把 model 注册到 app 的 _models 里面，但是当 app start 之后，就不能仅仅用这种方法了，需要 injectModel
  }

  /**
   * Inject model after app is started.
   *
   * @param createReducer
   * @param onError
   * @param unlisteners
   * @param m
   */
  function injectModel(createReducer, onError, unlisteners, m) {
    model(m);

    const store = app._store;
    if (m.reducers) {
      store.asyncReducers[m.namespace] = getReducer(m.reducers, m.state);
      store.replaceReducer(createReducer(store.asyncReducers));
    }
    if (m.effects) {
      store.runSaga(app._getSaga(m.effects, m, onError, plugin.get('onEffect')));
    }
    if (m.subscriptions) {
      unlisteners[m.namespace] = runSubscription(m.subscriptions, m, app, onError);
    }
  }

  /**
   * Unregister model.
   *
   * @param createReducer
   * @param reducers
   * @param unlisteners
   * @param namespace
   *
   * Unexpected key warn problem:
   * https://github.com/reactjs/redux/issues/1636
   */
  function unmodel(createReducer, reducers, unlisteners, namespace) {
    const store = app._store;

    // Delete reducers
    delete store.asyncReducers[namespace];
    delete reducers[namespace];
    store.replaceReducer(createReducer());
    store.dispatch({ type: '@@dva/UPDATE' });

    // Cancel effects
    store.dispatch({ type: `${namespace}/@@CANCEL_EFFECTS` });

    // Unlisten subscrioptions
    unlistenSubscription(unlisteners, namespace);

    // Delete model from app._models
    app._models = app._models.filter(model => model.namespace !== namespace);
  }

  /**
   * Start the app.
   *
   * @returns void
   */
  function start() {
    // Global error handler
    const onError = (err) => {
      if (err) {
        if (typeof err === 'string') err = new Error(err);
        err.preventDefault = () => {
          err._dontReject = true;
        };
        plugin.apply('onError', (err) => { // 我们要注意这里的 apply 并不是我们熟知的函数的apply，而是 plugin 实例的一个方法
          throw new Error(err.stack || err);
        })(err, app._store.dispatch);
      }
    };

    const sagaMiddleware = createSagaMiddleware(); // 直接从 redux-saga 中引用的方法
    const {
      middleware: promiseMiddleware, // 解构赋值，将 middleware 重新赋值为 promiseMiddleware
      resolve,
      reject,
    } = createPromiseMiddleware(app);
    app._getSaga = getSaga.bind(null, resolve, reject);

    const sagas = [];
    const reducers = { ...initialReducer };
    for (const m of app._models) {
      reducers[m.namespace] = getReducer(m.reducers, m.state);
      /*
      * 有一些思考，写在这里吧：
      * 我们这里的 reducers，实际上要和 action 中的 actionType 同名的 reducer，
      *             所以这里我们没有必要去写 switch case 了，对于某一个 reducer 来说其行为应该是确定的
      *             这给 reducers 的写法带来了一定的简化
      *             当然，我们可以使用 extraReducers 定义我们之前习惯的那种比较复杂的 reducers
      * ***/
      // getReducer 传入两个参数，第一个是该模型的reducer、第二个是该模型的state
      if (m.effects) sagas.push(app._getSaga(m.effects, m, onError, plugin.get('onEffect')));
    }
    const reducerEnhancer = plugin.get('onReducer');
    const extraReducers = plugin.get('extraReducers');
    /*
    * extraReducers：为我们可能需要引入的外部 reducers ，比如我们使用 redux-form 插件，就需要引入其外部 reducer，或者我们自己定义
    * **/
    invariant(
      Object.keys(extraReducers).every(key => !(key in reducers)),
      `[app.start] extitraReducers is conflict with other reducers, reducers list: ${Object.keys(reducers).join(', ')}`,
    );

    // Create store
    const store = app._store = createStore({ // eslint-disable-line
      reducers: createReducer(),
      initialState: hooksAndOpts.initialState || {},
      plugin,
      createOpts,
      sagaMiddleware,
      promiseMiddleware,
    });

    // Extend store
    store.runSaga = sagaMiddleware.run;
    store.asyncReducers = {};

    // Execute listeners when state is changed
    const listeners = plugin.get('onStateChange');
    for (const listener of listeners) {
      store.subscribe(() => {
        listener(store.getState()); // redux 提供的能力， subscribe 监听 state 的变化，触发监听事件
      });
    }

    // Run sagas
    sagas.forEach(sagaMiddleware.run); // 这实际上是调用react-saga中执行saga的方法

    // Setup app
    setupApp(app);

    // Run subscriptions
    const unlisteners = {};
    /**
     * 每一个 model 在定义的时候可能定义了多个 subscriptions
     * 这些 subscriptions 的触发可能是全局的，并且和 models 本身以及 redux 的dispatch没有直接关系
     * 为什么这里起名叫做 unlisteners 呢? 我想是因为下一步用到它的时候就是对其进行卸载了(移除 models 的时候需要卸载 subscriptions)
     * 另外对于每一个 subscription，卸载方法应该是由开发者返回的，见文档:
     * Notice: if we want to unregister a model with `app.unmodel()`,
     *         it's subscriptions must return unsubscribe method.
     * **/
    for (const model of this._models) {
      if (model.subscriptions) {
        unlisteners[model.namespace] = runSubscription(model.subscriptions, model, app, onError);
      }
    }

    // Setup app.model and app.unmodel
    app.model = injectModel.bind(app, createReducer, onError, unlisteners);
    app.unmodel = unmodel.bind(app, createReducer, reducers, unlisteners);

    /**
     * Create global reducer for redux.
     *
     * @returns {Object}
     */
    function createReducer() {
      return reducerEnhancer(combineReducers({
        ...reducers,
        ...extraReducers,
        ...(app._store ? app._store.asyncReducers : {}),
      }));
    }
  }
}
