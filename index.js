const osascript = require('node-osascript');
const udp = require('dgram');
const EventEmitter = require('events');
const osc = require('osc-min');

/**
 * An OSC message object
 * @typedef {Object} OscMsg
 * @property {string} oscType - message or bundle
 * @property {string} address - OSC address
 * @property {string[]} pathArr - An array of address parts
 * @property {OscArg[]} args - An array of OSC arguments
 * @property {Array} argsArr - An array of OSC argument values
 */

/**
 * An OSC argument object
 * @typedef {Object} OscArg
 * @property {string} type - OSC argument type
 * @property {string|number|boolean} value - Argument value
 */

/**
 * A Soundscape object
 * @typedef {Object} CacheObj
 * @property {string|number} num - The En-Scene object number
 * @property {string} name - The object name
 * @property {number} x - The object's x-coordinate
 * @property {number} y - The object's y-coordinate
 */

/**
 * The config object
 * @typedef {Object} DbsceneConfig
 * @property {Object} qlab - The QLab-related options
 * @property {String} qlab.address - The IP address of the QLab machine
 * @property {integer} qlab.ds100Patch
 * @property {float} qlab.defaultDuration
 * @property {Object} ds100 - The DS100-related options
 * @property {String} ds100.address - The IP address of the DS100
 * @property {integer} ds100.defaultMapping=
 * @property {integer} logging - The logging level
 */

/**
 * Extends the OSC message format as defined by the osc-min package
 * @param {Object} msg A UDP message
 * @returns {OscMsg} An OSC message object
 */
function fromBuffer(msg) {
	const oscMinMsg = osc.fromBuffer(msg);
	const extendedMsg = oscMinMsg;
	extendedMsg.pathArr = oscMinMsg.address.split('/').slice(1);
	extendedMsg.argsArr = oscMinMsg.args.map((arg) => arg.value);
	if (extendedMsg.argsArr.length > 0) {
		extendedMsg.oscString = `${oscMinMsg.address} ${oscMinMsg.argsArr.join(' ')}`;
	} else {
		extendedMsg.oscString = `${oscMinMsg.address}`;
	}
	return extendedMsg;
}

/**
 * Log a received OSC message to the console
 * @param {OscMsg} oscMessage The osc message
 * @param {Object} rinfo UDP message info
 * @returns {void}
 */
function logOscIn(oscMessage, rinfo) {
	console.log(`dbscene: received: "${oscMessage.oscString}" from ${rinfo.address}:${rinfo.port}`);
}

/**
 * Log a sent OSC message to the console
 * @param {OscMsg} message The OSC message being logged
 * @param {string} address The address to which the message was sent
 * @param {string|number} port The port to which the message was sent
 * @returns {void}
 */
function logOscOut(message, address, port) {
	const sentString =
		message.args.length > 0 ? `"${message.address} ${message.args}"` : `"${message.address}"`;
	let destination = '';
	if (!address) {
		destination = '';
	} else if (!port) {
		destination = ` to ${address}`;
	} else {
		destination = ` to ${address}:${port}`;
	}
	console.log(`dbscene: sent: ${sentString}${destination}`);
}

/**
 * Check whether object number is in range 1-64
 * @param {number|string} objNum
 * @returns {number} The object number, parsed as an integer
 */
function checkNum(objNum) {
	const num = parseInt(objNum);
	if (num < 1 || num > 64) throw new Error('Object number is out of range');
	return num;
}

/**
 * Check whether mapping number is in range 1-4
 * @param {number|string} mapping
 * @returns {number} The mapping number, parsed as an integer
 */
function checkMapping(mapping) {
	const num = parseInt(mapping);
	if (num < 1 || num > 4)
		throw new Error(`Mapping number is out of range 1-4, received ${mapping}`);
	return num;
}

class Dbscene extends EventEmitter {
	/**
	 * Constructor
	 * @param {DbsceneConfig} config
	 * @param {CacheObj[]} cache The Soundscape objects
	 */
	constructor(config, cache) {
		super();
		this.cache = cache;
		this.config = config;
		this.config.ds100.port = 50010;
		this.config.ds100.reply = 50011;
		this.config.qlab.port = 53000;
		this.config.qlab.reply = 53001;
		if (this.config.logging === undefined) this.config.logging = 0;
		this.dbServer = udp.createSocket('udp4');
		this.qlabServer = udp.createSocket('udp4');
		console.log('dbscene: Logging level:', this.config.logging);
	}

	/**
	 * Get a shallow copy of the cache
	 * @returns {CacheObj[]} A shallow copy of the cache
	 */
	getCache() {
		return this.cache.slice(0);
	}

	/**
	 * Starts the DS100 server, binds to the DS100 Reply port
	 * @returns {Object} The UDP server for the DS100
	 */
	startDbServer() {
		const { dbServer } = this;

		dbServer.bind(this.config.ds100.reply, () => {
			console.log(
				`dbscene: dbServer listening on ${dbServer.address().address}:${dbServer.address().port}`
			);
		});

		// Dbscene needs to allow many simulataneous listeners in order to create scene's with up to 64 objects; the node default maximum is too low
		dbServer.setMaxListeners(100);

		dbServer.on('error', (error) => {
			console.error(error);
			dbServer.close(() => {
				this.emit('dbServerClosed');
				console.log('dbscene: dbServer has closed due to error');
			});
			throw error;
		});

		// Incoming message handler
		dbServer.on('message', (msg, rinfo) => {
			try {
				const oscMessage = fromBuffer(msg);
				if (this.config.logging >= 2) logOscIn(oscMessage, rinfo);
				if (oscMessage.pathArr[0] === 'dbscene') {
					dbServer.emit('dbscene', oscMessage);
				} else if (oscMessage.pathArr[0] === 'dbaudio1') {
					dbServer.emit('dbaudio1', oscMessage);
				} else {
					console.error(
						new Error(`dbscene dbServer received an unusable OSC message: ${oscMessage.oscString}`)
					);
				}
			} catch (error) {
				console.error(
					`dbscene Could not interpret incoming message from ${rinfo.address}:${rinfo.port}`
				);
				console.error(error);
			}
		});

		dbServer.on('dbscene', (oscMessage) => {
			const path1 = oscMessage.pathArr[1];
			if (path1 === 'create') {
				this.dbsceneCreate(oscMessage).catch((error) => {
					console.error(error);
				});
			} else if (path1 === 'update') {
				this.dbsceneUpdate(oscMessage);
			} else {
				console.error(
					new Error(`dbscene: dbServer received an unusable message: ${oscMessage.oscString}`)
				);
			}
		});

		dbServer.on('dbaudio1', (oscMessage) => {
			try {
				if (oscMessage.pathArr[1] === 'coordinatemapping' && oscMessage.argsArr.length > 0) {
					this.receivedCoordinates(oscMessage);
				}
			} catch (error) {
				console.error(error);
			}
		});

		return dbServer;
	}

	/**
	 * Starts the QLab server, binds to the QLab Reply port
	 * @returns {Object} The UDP server for QLab
	 */
	startQLabServer() {
		const { qlabServer } = this;

		qlabServer.bind(this.config.qlab.reply, () => {
			console.log(
				`dbscene: qlabServer listening on ${qlabServer.address().address}:${
					qlabServer.address().port
				}`
			);
		});

		qlabServer.setMaxListeners(100);

		qlabServer.on('error', (error) => {
			console.error(error);
			qlabServer.close(() => {
				this.emit('qlabServerClosed');
				console.log('dbscene: qlabServer has closed due to error');
			});
			throw error;
		});

		// Imcoming message handler
		qlabServer.on('message', (msg, rinfo) => {
			try {
				const oscMessage = fromBuffer(msg);
				if (this.config.logging >= 2) logOscIn(oscMessage, rinfo);

				if (oscMessage.pathArr[0] === 'reply') {
					const replyJSON = JSON.parse(oscMessage.argsArr[0]);
					qlabServer.emit('qlabReplied', replyJSON);
				}
			} catch (error) {
				console.error(
					`QLab Server could not interpret incoming message from ${rinfo.address}:${rinfo.port}:`
				);
				console.error(error);
			}
		});

		return qlabServer;
	}

	/**
	 * Updates the cache positions with the newly received coordinates
	 * @param {OscMsg} oscMessage An OSC message object
	 * @returns {void}
	 */
	async receivedCoordinates(oscMessage) {
		// Coordinate message format is: /dbaudio1/coordinatemapping/source_position[_x, _y, _xy]/[mapping]/[object] [x] [y]
		let newX;
		let newY;
		if (oscMessage.pathArr[2].endsWith('_y')) {
			// Determines whether the received coordinates in include X, Y, or both
			[newY] = oscMessage.argsArr;
		} else {
			[newX, newY] = oscMessage.argsArr;
		}

		try {
			const cacheObj = await this.getCacheObj(parseInt(oscMessage.pathArr[4]));
			if (newX) cacheObj.x = newX;
			if (newY) cacheObj.y = newY;
			this.dbServer.emit('cacheUpdated', cacheObj);
			this.emit('cacheUpdated', cacheObj); // This goes out so server.js can pass coordinates on to the web GUI via socketio
		} catch (error) {
			console.error(error);
		}
	}

	/**
	 * create a new dbscene
	 * @param {OscMsg} oscMessage An OSC message addressed to /dbscene/create, with or without arguments
	 * @returns {void}
	 */
	async dbsceneCreate(oscMessage) {
		const mapping =
			oscMessage.argsArr.length > 0
				? checkMapping(oscMessage.argsArr[0])
				: checkMapping(this.config.ds100.defaultMapping);

		await this.queryAllObjPos();

		let groupCueID;
		try {
			groupCueID = await this.newDbsceneGroup(); // newTempGroup returns the cue ID of the created cue.
			this.sendToQLab({
				address: `/cue_id/${groupCueID}/name`,
				args: ['dbscene: '],
			});
		} catch (error) {
			console.error(error);
		}

		// eslint-disable-next-line no-restricted-syntax
		for (const cacheObj of this.cache) {
			try {
				const cueID = await this.newNetworkCue(cacheObj.num);

				this.sendToQLab({
					address: `/cue_id/${cueID}/patch`,
					args: [this.config.qlab.ds100Patch],
				});
				this.sendToQLab({
					address: `/cue_id/${cueID}/messageType`,
					args: [2],
				});
				this.sendToQLab({
					address: `/cue_id/${cueID}/customString`,
					args: [
						`/dbaudio1/coordinatemapping/source_position_xy/${mapping}/${cacheObj.num} ${cacheObj.x} ${cacheObj.y}`,
					],
				});
				this.sendToQLab({
					address: `/cue_id/${cueID}/name`,
					args: [`${cacheObj.num} - ${cacheObj.name || '(unnamed)'}: ${cacheObj.x}, ${cacheObj.y}`],
				});
				this.sendToQLab({
					address: `/cue_id/${cueID}/duration`,
					args: [this.config.qlab.defaultDuration],
				});
				this.sendToQLab({
					address: `/move/${cueID}`,
					args: [-1, `${groupCueID}`],
				});
			} catch (error) {
				console.error(error);
			}
		}

		try {
			// Selects and collapses the group using both OSC and osascript
			await this.selectAndCollapseCue(groupCueID);
		} catch (error) {
			console.error(error);
		}
	}

	/**
	 * Update the selected dbscene
	 * @param {OscMsg} oscMessage An OSC message addressed to /dbscene/update
	 * @returns {void}
	 */
	async dbsceneUpdate() {
		const selectedCues = await this.getSelectedCues();
		selectedCues.forEach(async (selectedCue) => {
			try {
				if (selectedCue.type === 'Group' && selectedCue.name.startsWith('dbscene:')) {
					this.updateGroupCue(selectedCue.uniqueID);
				} else if (selectedCue.type === 'Network') {
					this.updateNetworkCue(selectedCue.uniqueID);
				}
			} catch (error) {
				console.error(error);
			}
		});
	}

	/**
	 * Update a dbscene Group cue to current positions
	 * @param {string} cueID The unique ID of the cue
	 */
	async updateGroupCue(cueID) {
		const children = await this.getChildrenOfCue(cueID);
		children.forEach((childCue) => {
			if (childCue.type === 'Network') {
				try {
					this.updateNetworkCue(childCue.uniqueID);
				} catch (error) {
					console.error(error);
				}
			}
		});
	}

	/**
	 * Update a dbscene Network cue to current position
	 * @param {string} cueID The unique ID of the cue
	 */
	async updateNetworkCue(cueID) {
		// Get the custom message of the child cue
		const customMessage = await this.getCustomMessageOfCue(cueID);
		const messageParts = customMessage.split(' ');

		// Custom Message validity check
		const coordMapAddressRegex = /\/dbaudio1\/coordinatemapping\/source_position(_(x|y|xy))?\/[1-4]\/([1-9]$|[1-5][0-9]|6[0-4])/;
		if (!coordMapAddressRegex.test(messageParts[0])) {
			throw new Error('The network cue was not properly addressed for DS100 coordinate mapping');
		}

		const messageAddress = messageParts[0].split('/').slice(1);
		const existingMapping = messageAddress[3];
		const objNum = parseInt(messageAddress[4]);
		const cacheObj = this.getCacheObj(objNum);

		try {
			await this.queryObjPos(cacheObj, existingMapping);
		} catch (error) {
			console.error(error);
		}

		this.sendToQLab({
			address: `/cue_id/${cueID}/customString`,
			args: [
				`/dbaudio1/coordinatemapping/source_position_xy/${existingMapping}/${cacheObj.num} ${cacheObj.x} ${cacheObj.y}`,
			],
		});
		this.sendToQLab({
			address: `/cue_id/${cueID}/name`,
			args: [`${cacheObj.num} - ${cacheObj.name || '(unnamed)'}: ${cacheObj.x}, ${cacheObj.y}`],
		});
	}

	/**
	 * Query DS100 for current position of an En-Scene object. Repeats query message every 250ms until reply is received. Timeout after 2.5 seconds.
	 * @param {CacheObj} cacheObj The cache object to be updated
	 * @param {number|string} mapping The mapping to be queried
	 * @returns {CacheObj} The updated cache object
	 */
	queryObjPos(cacheObj, mapping = parseInt(this.config.ds100.defaultMapping)) {
		checkMapping(mapping);
		const objNum = cacheObj.num;

		return new Promise((resolve, reject) => {
			this.sendToDS100({
				oscType: 'message',
				address: `/dbaudio1/coordinatemapping/source_position_xy/${mapping}/${objNum}`,
				args: [],
			});

			const repeater = setInterval(() => {
				this.sendToDS100({
					oscType: 'message',
					address: `/dbaudio1/coordinatemapping/source_position_xy/${mapping}/${objNum}`,
					args: [],
				});
			}, 250);

			this.dbServer.on('cacheUpdated', (updatedCacheObj) => {
				if (parseInt(updatedCacheObj.num) === objNum) {
					clearInterval(repeater);
					resolve(updatedCacheObj);
				}
			});

			setTimeout(() => {
				clearInterval(repeater);
				reject(new Error(`DS100 OSC reply timeout for Object ${objNum}`));
			}, 2500);
		});
	}

	/**
	 * Query the position of every object in the cache
	 * @param {number|string} mapping The mapping to be queried
	 * @returns {CacheObj[]} The updated full cache
	 */
	async queryAllObjPos(mapping = parseInt(this.config.ds100.defaultMapping)) {
		checkMapping(mapping);
		const queryArray = [];
		this.cache.forEach((cacheObj) => {
			// Query position of every object in the cache, and add the resulting promise to the promiseArray
			try {
				queryArray.push(this.queryObjPos(cacheObj, mapping));
			} catch (error) {
				console.error(error);
			}
		});

		try {
			await Promise.all(queryArray); // Wait for all object position queries to complete
			if (this.config.logging >= 1)
				console.log('dbscene: Position queries for all cache objects have been resolved');
			return this.cache;
		} catch (error) {
			console.error('dbscene: 1 or more position queries were rejected:');
			if (this.config.logging >= 1) console.error(error);
			throw error;
		}
	}

	/**
	 * Send an OSC message to QLab
	 * @param {OscMsg} oscMessage The message object to be sent
	 * @returns {string} Returns 'sent' upon success
	 */
	async sendToQLab(oscMessage) {
		const buffer = osc.toBuffer(oscMessage);
		this.qlabServer.send(
			buffer,
			0,
			buffer.length,
			this.config.qlab.port,
			this.config.qlab.address,
			(error) => {
				if (error) {
					console.error('Could not send OSC message to QLab');
					console.error(error);
					throw error;
				}
				if (this.config.logging >= 1)
					logOscOut(oscMessage, this.config.qlab.address, this.config.qlab.port);
			}
		);
	}

	/**
	 * Send an OSC message to the DS100
	 * @param {OscMsg} oscMessage The message object to be sent
	 * @returns {string} Returns 'sent' upon success
	 */
	async sendToDS100(oscMessage) {
		const buffer = osc.toBuffer(oscMessage);
		this.dbServer.send(
			buffer,
			0,
			buffer.length,
			this.config.ds100.port,
			this.config.ds100.address,
			(error) => {
				if (error) {
					console.error('Could not send OSC message to DS100');
					console.error(error);
					throw error;
				}
				if (this.config.logging >= 1)
					logOscOut(oscMessage, this.config.ds100.address, this.config.ds100.port);
			}
		);
	}

	/**
	 * Create a QLab group cue to hold the new network cues
	 * @returns {string} The unique ID of the new group cue
	 */
	newDbsceneGroup() {
		return new Promise((resolve, reject) => {
			this.qlabServer.on('qlabReplied', (reply) => {
				if (reply.address.endsWith('/new')) {
					resolve(reply.data); // The reply data is the uniqueID of the new cue
				}
			});

			this.sendToQLab({ address: '/new', args: ['group'] });

			setTimeout(() => {
				reject(new Error('QLab OSC reply timeout'));
			}, 1000);
		});
	}

	/**
	 * Create a QLab network cue
	 * @returns {string} The unique ID of the new network cue
	 */
	newNetworkCue() {
		return new Promise((resolve, reject) => {
			this.qlabServer.on('qlabReplied', (reply) => {
				if (reply.address.endsWith('/new')) {
					resolve(reply.data); // The reply data is the uniqueID of the new cue
				}
			});

			this.sendToQLab({ address: '/new', args: ['network'] });

			setTimeout(() => {
				reject(new Error('QLab OSC reply timeout'));
			}, 1000);
		});
	}

	/**
	 * Select and collapse a QLab cue
	 * @param {string} cueID The uniqueID of the cue
	 * @returns {string} The cue ID
	 */
	async selectAndCollapseCue(cueID) {
		this.sendToQLab({ address: `/select_id/${cueID}`, args: [] });
		osascript.execute(
			`tell application id "com.figure53.QLab.4" to tell front workspace\n collapse cue id "${cueID}"\n end tell`,
			(osaerror) => {
				if (osaerror) {
					console.error(
						'dbscene: An error has occured while attempting to use osascript to control QLab'
					);
					console.error(osaerror);
				}
			}
		);
		return cueID;
	}

	/**
	 * Get QLab's currently selected cues for the purpose of updates
	 * @returns {Object[]} The selected cues
	 */
	getSelectedCues() {
		return new Promise((resolve, reject) => {
			this.qlabServer.on('qlabReplied', (reply) => {
				if (reply.address.endsWith('/selectedCues/shallow')) {
					resolve(reply.data); // The reply data is an array of selected cues
				}
			});

			this.sendToQLab({ address: '/selectedCues/shallow', args: [] });

			setTimeout(() => {
				reject(new Error('Qlab OSC reply timeout'));
			}, 1000);
		});
	}

	/**
	 * Get children of a given QLab cue
	 * @param {string} uniqueID The unique ID of the group cue being queried
	 * @returns {Object[]} The child cues
	 */
	getChildrenOfCue(uniqueID) {
		return new Promise((resolve, reject) => {
			this.qlabServer.on('qlabReplied', (reply) => {
				if (reply.address.endsWith(`/cue_id/${uniqueID}/children/shallow`)) {
					resolve(reply.data); // The reply data is an array of selected cues
				}
			});

			this.sendToQLab({ address: `/cue_id/${uniqueID}/children/shallow`, args: [] });

			setTimeout(() => {
				reject(new Error('QLab OSC reply timeout'));
			}, 1000);
		});
	}

	/**
	 * Get custom OSC message of a given QLab network cue
	 * @param {string} uniqueID The unique ID of the network cue being queried
	 * @returns {string} The custom OSC message of the queried cue
	 */
	getCustomMessageOfCue(uniqueID) {
		return new Promise((resolve, reject) => {
			this.qlabServer.on('qlabReplied', (reply) => {
				if (reply.address.endsWith(`/cue_id/${uniqueID}/customString`)) {
					resolve(reply.data); // The reply data is the custom OSC message of the cue
				}
			});

			this.sendToQLab({
				address: `/cue_id/${uniqueID}/customString`,
				args: [],
			});

			setTimeout(() => {
				reject(new Error('QLab OSC reply timeout'));
			}, 1000);
		});
	}

	/**
	 * Returns the first object in the instance's cache with num = objNum
	 * @param {string|number} objNum The number of the cache object
	 * @returns {CacheObj} The cache object
	 */
	getCacheObj(objNum) {
		const num = checkNum(objNum);
		const cacheObj = this.cache.find((obj) => obj.num === num);

		if (!cacheObj) {
			throw new Error(`Cache object ${num} could not be found`);
		}

		return cacheObj;
	}

	/**
	 * Deletes the object from the cache
	 * @param {string|number} objNum The number of the cache object
	 * @returns {CacheObj[]} The full cache
	 */
	removeCacheObj(objNum) {
		const num = checkNum(objNum);

		const cacheObj = this.getCacheObj(num);
		const configObjIndex = this.cache.indexOf(cacheObj);

		if (configObjIndex < 0) throw new Error('The cache object could not be found');
		this.cache.splice(configObjIndex, 1);

		return this.cache;
	}

	/**
	 * Adds a new object to the cache and sorts the cache by number, then queries the position of the object and returns the object.
	 * @param {string|number} objNum The number of the new object, range 1-64
	 * @param {string} objName The name of the new object
	 * @returns {CacheObj} The new cache object
	 */
	async newCacheObj(objNum, objName) {
		const num = checkNum(objNum);
		const newObj = { num, name: objName, x: 0, y: 0 };

		this.cache.push(newObj);
		this.cache.sort((first, next) => {
			if (first.num < next.num) return -1;
			if (first.num > next.num) return 1;
			return 0;
		});

		try {
			await this.queryObjPos(newObj);
		} catch (error) {
			console.error(error);
		}

		const cacheObj = await this.getCacheObj(num);
		return cacheObj;
	}

	/**
	 * Update an existing object's name
	 * @param {number|string} objNum The number of the object, range 1-64
	 * @param {string} objName The new name of the object
	 * @returns {CacheObj} The updated cache object, with refreshed coordinates
	 */
	async updateCacheObj(objNum, objNewName) {
		const num = checkNum(objNum);
		const cacheObj = await this.getCacheObj(num);

		cacheObj.name = objNewName;

		try {
			await this.queryObjPos(cacheObj);
		} catch (error) {
			console.error(error);
		}

		return cacheObj;
	}

	/**
	 * Returns the dbscene listening port
	 * @returns {number|string} The port that dbscene is listening on (default is 50011)
	 */
	// eslint-disable-next-line class-methods-use-this
	getListenPort() {
		return this.config.ds100.reply;
	}
}

module.exports = Dbscene;
