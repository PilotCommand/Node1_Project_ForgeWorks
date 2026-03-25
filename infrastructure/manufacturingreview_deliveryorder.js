// ============================================================================
// manufacturingreview_deliveryorder.js — Delivery Order File System Module
// Manufacturing Review — Forgeworks Infrastructure
// ============================================================================
// Owns all File System Access API logic for the Manufacturing Review.
// No DOM manipulation. No state mutations. No imports from other MR modules.
// Callers are responsible for updating state and refreshing the UI.
//
// Requires Chrome or Edge (File System Access API). Use isSupported() to check
// before calling any other function. All async functions reject with a plain
// Error on failure — callers should catch and handle.
//
// IndexedDB persistence:
//   Database : 'forgeworks-fs'  (version 1)
//   Store    : 'handles'
//   Key      : 'working-folder'
//   Value    : FileSystemDirectoryHandle
//
// Compatible file detection (scanFolder):
//   1. Filename ends in .json
//   2. Parses as valid JSON
//   3. Has _type === 'forgeworks-mfg-review'
//
// Imports:  nothing
// Exports:  isSupported()
//           requestWorkingFolder()
//           restoreWorkingFolder()
//           scanFolder(dirHandle)
//           readOrderFile(fileHandle)
//           saveOrderToFolder(dirHandle, filename, payload)
//           deleteOrderFile(fileHandle)
//           buildOrderFilename(general)
// ============================================================================


// ---------------------------------------------------------------------------
// Browser Support Check
// ---------------------------------------------------------------------------

/**
 * Returns true if the File System Access API is available in this browser.
 * Chrome and Edge support it. Firefox and Safari do not (as of 2025).
 * Always call this before any other function in this module.
 *
 * @returns {boolean}
 */
export function isSupported() {
  return typeof window !== 'undefined' &&
         typeof window.showDirectoryPicker === 'function';
}


// ---------------------------------------------------------------------------
// IndexedDB Helper — tiny inline wrapper, no external library
// ---------------------------------------------------------------------------

var IDB_NAME    = 'forgeworks-fs';
var IDB_VERSION = 1;
var IDB_STORE   = 'handles';

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function idbOpen() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror   = function(e) { reject(e.target.error);   };
  });
}

/**
 * Write a value to the handles store.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
function idbSet(key, value) {
  return idbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(IDB_STORE, 'readwrite');
      var req = tx.objectStore(IDB_STORE).put(value, key);
      req.onsuccess = function() { resolve(); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

/**
 * Read a value from the handles store.
 * Resolves with undefined if the key does not exist.
 * @param {string} key
 * @returns {Promise<*>}
 */
function idbGet(key) {
  return idbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(IDB_STORE, 'readonly');
      var req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror   = function(e) { reject(e.target.error);   };
    });
  });
}


// ---------------------------------------------------------------------------
// Working Folder — Request & Restore
// ---------------------------------------------------------------------------

/**
 * Ask the user to select a working folder via the browser's directory picker.
 * The selected handle is persisted to IndexedDB so it can be restored on the
 * next visit without showing the picker again (subject to re-permission).
 *
 * Rejects if the user cancels the picker or if the API is not supported.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export function requestWorkingFolder() {
  if (!isSupported()) {
    return Promise.reject(new Error('File System Access API is not supported in this browser.'));
  }

  return window.showDirectoryPicker({ mode: 'readwrite' })
    .then(function(handle) {
      // Persist for future sessions — fire and forget, don't block on IDB
      idbSet('working-folder', handle).catch(function(err) {
        console.warn('forgeworks: failed to persist folder handle to IndexedDB:', err);
      });
      return handle;
    });
}

/**
 * Attempt to restore a previously selected working folder from IndexedDB.
 * If found, re-requests read/write permission (the browser may show a small
 * permission prompt on the first interaction after a page load).
 *
 * Resolves with the handle if permission is granted.
 * Resolves with null if no handle is saved, or if permission is denied/dismissed.
 *
 * Never rejects — safe to call unconditionally on startup.
 *
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export function restoreWorkingFolder() {
  return idbGet('working-folder')
    .then(function(handle) {
      if (!handle) return null;

      return handle.requestPermission({ mode: 'readwrite' })
        .then(function(result) {
          return result === 'granted' ? handle : null;
        });
    })
    .catch(function(err) {
      console.warn('forgeworks: could not restore working folder:', err);
      return null;
    });
}


// ---------------------------------------------------------------------------
// Folder Scan
// ---------------------------------------------------------------------------

/**
 * Scan a directory handle for compatible Forgeworks delivery order JSON files.
 * Only reads the file header (general sub-object) for each compatible file —
 * the full node graph is NOT loaded here. That happens in readOrderFile().
 *
 * Skips non-.json files and files that fail the compatibility check silently.
 *
 * Returns an array of summary objects, one per compatible file found:
 * {
 *   filename:       string,                 // e.g. "000001_2025-03-24_143022.json"
 *   fileHandle:     FileSystemFileHandle,
 *   doNumber:       string,                 // general.doNumber (or migrated jobNumber)
 *   partNumber:     string,
 *   partName:       string,
 *   customer:       string,
 *   status:         string,                 // draft | review | approved | released | obsolete
 *   dateCreated:    string,
 *   version:        string,                 // _version field from file
 *   isParent:       boolean,                // true if this order has child batches
 *   isChild:        boolean,                // true if this order is a child batch
 *   parentDoNumber: string|null,            // base DO number of parent, null if not a child
 *   childCount:     number,                 // number of children (meaningful on parent only)
 * }
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<Array>}
 */
export function scanFolder(dirHandle) {
  var results = [];
  var promises = [];

  // Iterate directory entries — getEntriesForDirectory is async iterable
  var iterateEntries = function() {
    return new Promise(function(resolve, reject) {
      var entries = [];

      function collectNext(reader) {
        reader.read().then(function(batch) {
          if (batch.done) {
            resolve(entries);
            return;
          }
          entries = entries.concat(batch.value);
          collectNext(reader);
        }).catch(reject);
      }

      // Use the async iterator directly (modern API)
      if (dirHandle.entries) {
        var iter = dirHandle.entries();
        var collected = [];

        function readNext() {
          iter.next().then(function(result) {
            if (result.done) {
              resolve(collected);
              return;
            }
            // result.value is [name, handle]
            collected.push({ name: result.value[0], handle: result.value[1] });
            readNext();
          }).catch(reject);
        }

        readNext();
      } else {
        // Fallback for older API shape
        resolve([]);
      }
    });
  };

  return iterateEntries().then(function(entries) {
    var filePromises = entries
      .filter(function(entry) {
        return entry.handle.kind === 'file' &&
               entry.name.toLowerCase().endsWith('.json');
      })
      .map(function(entry) {
        return entry.handle.getFile()
          .then(function(file) {
            return file.text();
          })
          .then(function(text) {
            var parsed = JSON.parse(text);

            // Compatibility check
            if (parsed._type !== 'forgeworks-mfg-review') return null;

            var g = parsed.general || {};

            // Support both doNumber (v4.0+) and jobNumber (v3.0 migration)
            var doNumber = g.doNumber || g.jobNumber || '';

            return {
              filename:       entry.name,
              fileHandle:     entry.handle,
              doNumber:       doNumber,
              partNumber:     g.partNumber     || '',
              partName:       g.partName       || '',
              customer:       g.customer       || '',
              status:         g.status         || 'draft',
              dateCreated:    g.dateCreated    || '',
              version:        parsed._version  || '1.0',
              isParent:       !!g.isParent,
              isChild:        !!g.isChild,
              parentDoNumber: g.parentDoNumber || null,
              childCount:     g.childCount     || 0,
            };
          })
          .catch(function() {
            // Parse failure, unreadable file — skip silently
            return null;
          });
      });

    return Promise.all(filePromises);
  }).then(function(rawResults) {
    // Filter out nulls (skipped files) and sort by DO number ascending
    return rawResults
      .filter(function(r) { return r !== null; })
      .sort(function(a, b) {
        // Numeric DO number sort — parents before their children,
        // children sorted suffix descending (02 first, 00 last)
        if (a.doNumber < b.doNumber) return -1;
        if (a.doNumber > b.doNumber) return  1;
        return 0;
      });
  });
}


// ---------------------------------------------------------------------------
// Read Full Order
// ---------------------------------------------------------------------------

/**
 * Read and parse a single delivery order file in full.
 * Returns the complete parsed JSON payload — nodes, connections, general, etc.
 * The caller is responsible for validating the payload and loading it into state.
 *
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<object>}  Full JSON payload
 */
export function readOrderFile(fileHandle) {
  return fileHandle.getFile()
    .then(function(file) {
      return file.text();
    })
    .then(function(text) {
      var parsed = JSON.parse(text);
      if (parsed._type !== 'forgeworks-mfg-review') {
        throw new Error('File is not a Forgeworks Manufacturing Review delivery order.');
      }
      return parsed;
    });
}


// ---------------------------------------------------------------------------
// Save Order to Folder
// ---------------------------------------------------------------------------

/**
 * Write a delivery order payload as JSON to the working folder.
 * Creates the file if it does not exist; overwrites if it does.
 *
 * If a file with the given filename already exists and `filename` is the
 * generated default (not a user-chosen name), appends _1, _2, ... until a
 * free slot is found.  Pass `forceOverwrite: true` in options to skip this
 * and always overwrite.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string}                    filename     e.g. "mfg-review_DO-2025-001.json"
 * @param {object}                    payload      The full save payload object
 * @param {object}                    [options]
 * @param {boolean}                   [options.forceOverwrite=false]
 * @returns {Promise<FileSystemFileHandle>}  Handle to the written file
 */
export function saveOrderToFolder(dirHandle, filename, payload, options) {
  var forceOverwrite = options && options.forceOverwrite;
  var json = JSON.stringify(payload, null, 2);

  function writeToHandle(fileHandle) {
    return fileHandle.createWritable()
      .then(function(writable) {
        return writable.write(json)
          .then(function() { return writable.close(); })
          .then(function() { return fileHandle; });
      });
  }

  if (forceOverwrite) {
    return dirHandle.getFileHandle(filename, { create: true })
      .then(writeToHandle);
  }

  // Check if file exists; if so, find a free slot
  return dirHandle.getFileHandle(filename, { create: false })
    .then(function() {
      // File exists — find a free name
      var base = filename.replace(/\.json$/i, '');
      var counter = 1;

      function tryNext() {
        var candidate = base + '_' + counter + '.json';
        return dirHandle.getFileHandle(candidate, { create: false })
          .then(function() {
            // Still exists — try next
            counter++;
            return tryNext();
          })
          .catch(function() {
            // This name is free — use it
            return dirHandle.getFileHandle(candidate, { create: true })
              .then(writeToHandle);
          });
      }

      return tryNext();
    })
    .catch(function(err) {
      // getFileHandle with create:false throws if file doesn't exist — that's our
      // "file is free" signal. Any other error should propagate.
      if (err.name === 'NotFoundError' || err.name === 'TypeMismatchError') {
        return dirHandle.getFileHandle(filename, { create: true })
          .then(writeToHandle);
      }
      throw err;
    });
}


// ---------------------------------------------------------------------------
// Delete Order File
// ---------------------------------------------------------------------------

/**
 * Delete a delivery order file from disk.
 * Uses FileSystemFileHandle.remove() which is supported in Chrome 98+.
 * Rejects with an informative error on older browsers or if the operation fails.
 *
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<void>}
 */
export function deleteOrderFile(fileHandle) {
  if (typeof fileHandle.remove !== 'function') {
    return Promise.reject(new Error(
      'File deletion is not supported in this browser version. ' +
      'Please delete the file manually from your working folder.'
    ));
  }
  return fileHandle.remove();
}


// ---------------------------------------------------------------------------
// Filename Builder
// ---------------------------------------------------------------------------

/**
 * Generate a safe default filename for a delivery order based on its general
 * metadata. Used when saving a new order that does not yet have a filename.
 *
 * Format: <doNumber>_<YYYY-MM-DD>_<HHmmss>.json
 * The timestamp is taken from the current moment so each save is unique.
 * Non-alphanumeric characters in the DO number are replaced with hyphens.
 *
 * @param {object} general  The general state object (doNumber, etc.)
 * @returns {string}        e.g. "DO-2025-001_2025-03-24_143022.json"
 */
export function buildOrderFilename(general) {
  function sanitize(s) {
    return String(s || '').trim().replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  var now  = new Date();
  var date = now.toISOString().slice(0, 10);                          // YYYY-MM-DD
  var time = now.toTimeString().slice(0, 8).replace(/:/g, '');        // HHmmss

  var doNum = sanitize(general.doNumber);
  var parts = [];
  if (doNum) parts.push(doNum);
  parts.push(date);
  parts.push(time);

  return parts.join('_') + '.json';
}