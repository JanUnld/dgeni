import {Document} from './Document';
import {DocCollection} from './DocCollection';
import {Processor, ProcessorDef} from './Processor';
import {Module, FactoryDef, TypeDef} from './Module';

export type PackageRef = Package | string;

/**
 * A Dgeni Package containing processors, services and config blocks.
 * @param {string}   name         The name of the package
 * @param {string[]} dependencies The names of packages (or the actual packages) that this package
 *                                depends upon
 */
export class Package {

  static isPackage(pkg: any): pkg is Package {
    // Check the most important properties for dgeni to use a package
    return isString(pkg.name) && Array.isArray(pkg.dependencies) && isObject(pkg.module);
  }

  processors = [];
  configFns = [];
  handlers: {[key: string]: string[]} = {};
  // We can't use a real di.Module here as di uses instanceof to detect module instances
  module: Module = {};
  namedDependencies: string[];

  constructor(public name: string, public dependencies: PackageRef[] = []) {
    if ( typeof name !== 'string' ) { throw new Error('You must provide a name for the package'); }
    if ( dependencies && !Array.isArray(dependencies) ) { throw new Error('dependencies must be an array'); }
  }

  /**
   * Add a new processor to the package. The processor can be defined by a processor definition object
   * or a factory function, which can be injected with services and will return the processor definition
   * object.  The following properties of a processor definition object have special meaning to Dgeni:
   *
   * * `name : {string}`:  The name of the processor - if the processor is defined by a factory
   * function or a name is explicitly provided as the first parameter, then this is ignored
   * * `$process(docs : {string}) : {Array|Promise|undefined}`: The method that will be called to
   * process the documents. If it is async then it should return a Promise.
   * * `$runAfter : {string[]}`: Dgeni will ensure that this processor runs after those named here.
   * * `$runBefore : {string[]}`: Dgeni will ensure that this processor runs before those named here.
   * * `$validate: {Object}`: Dgeni will check that the properties of the processor, which match the
   * keys of this object, pass the validation rules provided as the values of this object. See
   * http://validatejs.org
   *
   * @param  {function|object|string} processorDefOrName
   * If this parameter is a string then it will be used as the processor's name, otherwise it is
   * assumed that it used as the `processorDef`
   *
   * @param {function|object} processorDef
   * The factory function or object that will be used by the injector to create the processor.
   * * If a function then it is a factory and it must not be anonymous - it must have a name, e.g.
   *   `function myProcessor(dep1, dep2) { ... }` - since the name of the processor is taken from the
   *   name of the factory function.
   * * If an object, then it is the actual processor and must have a `name` property.  In this case,
   *   you cannot inject services into this processor.
   *
   * @return {Package}
   * `this` package, to allow methods to be chained.
   */
  processor(processorDefOrName: string | ProcessorDef, processorDef?: ProcessorDef) {

    let name: string;
    if (isString(processorDefOrName)) {
      name = processorDefOrName;
    } else {
      processorDef = processorDefOrName;
      // Using `any` here because Functions do usually have names (if they are not anonymous)
      if (!processorDef.name) { throw new Error('processorDef must be an object or a function with a name'); }
      name = processorDef.name;
    }

    if (typeof processorDef === 'function' ) {
      this.module[name] = ['factory', processorDef];
    } else {
      this.module[name] = ['value', processorDef];
    }

    this.processors.push(name);
    return this;
  }

  /**
   * Add a new service, defined by a factory function, to the package
   *
   * @param {function|string} serviceFactoryOrName
   * If a string then this is the name of the service, otherwise it is assumed to be the
   * `serviceFactory`.
   *
   * @param  {function} serviceFactory
   * The factory function that will be used by the injector to create the service.  The function must
   * not be anonymous - it must have a name, e.g. `function myService() { ... }` - since the name of
   * the service is taken from the name of the factory function.
   *
   * @return {Package}
   * "This" package, to allow methods to be chained.
   */
  factory(serviceFactoryOrName: string | FactoryDef, serviceFactory?: FactoryDef) {
    let name;
    if ( typeof serviceFactoryOrName === 'string' ) {
      name = serviceFactoryOrName;
    } else {
      serviceFactory = serviceFactoryOrName;
      if (!serviceFactory.name) { throw new Error('serviceFactory must have a name'); }
      name = serviceFactory.name;
    }

    if (typeof serviceFactory !== 'function' ) {
      throw new Error('serviceFactory must be a function.\nGot "' + typeof serviceFactory + '"');
    }

    this.module[name] = ['factory', serviceFactory];
    return this;
  }

  /**
   * Add a new service, defined as a Type to instantiated, to the package
   *
   * @param {function|string} ServiceTypeOrName
   * If a string then this is the name of the service, otherwise it is assumed to be the
   * `ServiceType`.
   *
   * @param  {function} ServiceType
   * The constructor function that will be used by the injector to create the processor.  The function
   * must not be anonymous - it must have a name, e.g. `function MyType() { ... }` - since the name of
   * the service is taken from the name of the constructor function.
   *
   * @return {Package}
   * "This" package, to allow methods to be chained.
   */
  type(ServiceTypeOrName: string | TypeDef, ServiceType?: TypeDef) {
    let name;
    if ( typeof ServiceTypeOrName === 'string' ) {
      name = ServiceTypeOrName;
    } else {
      ServiceType = ServiceTypeOrName;
      if (!ServiceType.name) { throw new Error('ServiceType must have a name'); }
      name = ServiceType.name;
    }
    if (typeof ServiceType !== 'function' ) { throw new Error('ServiceType must be a constructor function'); }

    this.module[name] = ['type', ServiceType];
    return this;
  }

  /**
   * Add a new config block to the package. Config blocks are run at the beginning of the doc
   * generation before the processors are run.  They can be injected with services and processors
   * to allow you access to their properties so that you can configure them.
   *
   * @param  {function} configFn         The config block function to run
   *
   * @return {Package}
   * "This" package, to allow methods to be chained.
   */
  config(configFn: Function) {
    if (typeof configFn !== 'function' ) { throw new Error('configFn must be a function'); }
    this.configFns.push(configFn);
    return this;
  }

  /**
   * Add an event handler to this package
   * @param  {string} eventName        The name of the event to handle
   * @param  {function} handlerFactory An injectable factory function that will return the handler
   * @return {Package}                 This package for chaining
   */
  eventHandler(eventName: string, handlerFactory: FactoryDef) {

    if ( typeof eventName !== 'string' ) {
      throw new Error('You must provide a string identifying the type of event to handle');
    }
    if (typeof handlerFactory !== 'function' ) {
      throw new Error('handlerFactory must be a function.\nGot "' + typeof handlerFactory + '"');
    }

    const handlers = this.handlers[eventName] = this.handlers[eventName] || [];
    const handlerName = handlerFactory.name || (this.name + '_' + eventName + '_' + handlers.length);
    this.factory(handlerName, handlerFactory);
    handlers.push(handlerName);
    return this;
  }
}

function isObject(value): value is Object {
  const type = typeof value;
  return !!value && (type === 'object' || type === 'function');
}

function isString(value): value is string {
  return typeof value === 'string';
}