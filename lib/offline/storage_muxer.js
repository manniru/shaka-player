/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

goog.provide('shaka.offline.StorageCellPath');
goog.provide('shaka.offline.StorageMuxer');

goog.require('shaka.util.Error');
goog.require('shaka.util.IDestroyable');
goog.require('shaka.util.MapUtils');


shaka.offline.StorageCellPath = class {
  /**
   * @param {string} mechanism
   * @param {string} cell
   */
  constructor(mechanism, cell) {
    this.mechanism_ = mechanism;
    this.cell_ = cell;
  }

  /** @return {string} */
  cell() { return this.cell_; }

  /** @return {string} */
  mechanism() { return this.mechanism_; }

  /** @override */
  toString() { return this.cell_ + '@' + this.mechanism_; }
};


/**
 * StorageMuxer is responsible for managing StorageMechanisms and addressing
 * cells. The primary purpose of the muxer is to give the caller the correct
 * cell for the operations they want to perform.
 *
 * |findActive| will be used when the caller wants a cell that supports
 * add-operations. This will be used when saving new content to storage.
 *
 * |findAll| will be used when the caller want to look at all the content
 * in storage.
 *
 * |resolvePath| will be used to convert a path (from |findActive| and
 * |findAll|) into a cell, which it then returns.
 *
 * @implements {shaka.util.IDestroyable}
 */
shaka.offline.StorageMuxer = class {
  constructor() {
    /**
     * A key in this map is the name given when registering a StorageMechanism.
     *
     * @private {!Object.<string, !shaka.extern.StorageMechanism>}
     */
    this.mechanisms_ = {};
  }

  /**
   * Free all resources used by the muxer, mechanisms, and cells. This should
   * not affect the stored content.
   *
   * @override
   */
  destroy() {
    /** @type {!Array.<!shaka.extern.StorageMechanism>} */
    let destroys = shaka.util.MapUtils
        .values(this.mechanisms_)
        .map((mechanism) => mechanism.destroy());

    // Empty each map so that subsequent calls will be no-ops.
    this.mechanisms_ = {};

    return Promise.all(destroys);
  }

  /**
   * Initialize the storage muxer. This must be called before any other calls.
   * This will initialize the muxer to use all mechanisms that have been
   * registered with |StorageMuxer.register|.
   *
   * @return {!Promise}
   */
  init() {
    const MapUtils = shaka.util.MapUtils;
    const StorageMuxer = shaka.offline.StorageMuxer;

    // Add the new instance of each mechanism to the muxer.
    MapUtils.forEach(StorageMuxer.registry_, (name, factory) => {
      this.mechanisms_[name] = factory();
    });

    let initPromises = MapUtils
        .values(this.mechanisms_)
        .map((mechanism) => mechanism.init());

    return Promise.all(initPromises);
  }

  /**
   * Get paths to all cells that support add-operations. All paths can be used
   * with |resolvePath|.
   *
   * @return {!Array.<!shaka.offline.StorageCellPath>}
   */
  findActive() {
    const MapUtils = shaka.util.MapUtils;

    /** @type {!Array.<!shaka.offline.StorageCellPath>} */
    let active = [];

    MapUtils.forEach(this.mechanisms_, (mechanismName, mechanism) => {
      MapUtils.forEach(mechanism.getCells(), (cellName, cell) => {
        if (!cell.hasFixedKeySpace()) {
          let path = new shaka.offline.StorageCellPath(mechanismName, cellName);
          active.push(path);
        }
      });
    });

    return active;
  }

  /**
   * @param {function(!shaka.offline.StorageCellPath,
   *                  !shaka.extern.StorageCell)} callback
   */
  forEachCell(callback) {
    const MapUtils = shaka.util.MapUtils;
    MapUtils.forEach(this.mechanisms_, (mechanismName, mechanism) => {
      MapUtils.forEach(mechanism.getCells(), (cellName, cell) => {
        let path = new shaka.offline.StorageCellPath(mechanismName, cellName);
        callback(path, cell);
      });
    });
  }

  /**
   * Get a specific storage cell. The promise will resolve with the storage
   * cell if it is found. If the storage cell is not found, the promise will
   * be rejected.
   *
   * @param {string} mechanismName
   * @param {string} cellName
   * @return {!Promise.<!shaka.extern.StorageCell>}
   */
  getCell(mechanismName, cellName) {
    let mechanism = this.mechanisms_[mechanismName];
    if (!mechanism) {
      return Promise.reject(new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.STORAGE,
          shaka.util.Error.Code.MISSING_STORAGE_CELL,
          'Could not find mechanism with name ' + mechanismName));
    }

    let cell = mechanism.getCells()[cellName];
    if (!cell) {
      return Promise.reject(new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.STORAGE,
          shaka.util.Error.Code.MISSING_STORAGE_CELL,
          'Could not find cell with name ' + cellName));
    }

    return Promise.resolve(cell);
  }

  /**
   * Find the cell that the path points to. A path is made up of a mount point
   * and a cell id. If a cell can be found, the cell will be returned. If no
   * cell is found, null will be returned.
   *
   * @param {shaka.offline.StorageCellPath} path
   * @return {shaka.extern.StorageCell}
   */
  resolvePath(path) {
    let mechanism = this.mechanisms_[path.mechanism()];

    if (!mechanism) { return null; }

    return mechanism.getCells()[path.cell()];
  }

  /**
   * This will erase all previous content from storage. Using paths obtained
   * before calling |erase| is discouraged, as cells may have changed during a
   * erase.
   *
   * @return {!Promise}
   */
  erase() {
    const MapUtils = shaka.util.MapUtils;

    let erases = MapUtils.values(this.mechanisms_).map((mechanism) => {
      return mechanism.erase();
    });

    // We do not need to re-init, as mechanisms are supposed to self-initialize
    // after an erase.
    return Promise.all(erases);
  }

  /**
   * Register a storage mechanism for use with the default storage muxer. This
   * will have no effect on any storage muxer already in main memory.
   *
   * @param {string} name
   * @param {function():!shaka.extern.StorageMechanism} factory
   * @export
   */
  static register(name, factory) {
    const StorageMuxer = shaka.offline.StorageMuxer;
    StorageMuxer.registry_[name] = factory;
  }


  /**
   * Unregister a storage mechanism for use with the default storage muxer. This
   * will have no effect on any storage muxer already in main memory.
   *
   * @param {string} name The name that the storage mechanism was registered
   *                      under.
   * @export
   */
  static unregister(name) {
    const StorageMuxer = shaka.offline.StorageMuxer;
    delete StorageMuxer.registry_[name];
  }
};


/**
 * @private {!Object.<string, function():!shaka.extern.StorageMechanism>}
 */
shaka.offline.StorageMuxer.registry_ = {};
