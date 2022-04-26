const EventEmitter = require('events')
const imaps = require('imap-simple')
const { simpleParser } = require('mailparser')
const addressparser = require('nodemailer/lib/addressparser')
const pSeries = require('p-series')
const retry = require('async-retry')
const debug = require('debug')('void-mail:imap')
const _ = require('lodash')
const Mail = require('../domain/mail')
const Attachment = require('../domain/attachments')
const toUpper = (thing) => (thing && thing.toUpperCase ? thing.toUpperCase() : thing);

// Just adding some missing functions to imap-simple... :-)

/**
 * Deletes the specified message(s).
 *
 * @param {string|Array} uid The uid or array of uids indicating the messages to be deleted
 * @param {function} [callback] Optional callback, receiving signature (err)
 * @returns {undefined|Promise} Returns a promise when no callback is specified, resolving when the action succeeds.
 * @memberof ImapSimple
 */
imaps.ImapSimple.prototype.deleteMessage = function (uid, callback) {
	var self = this;

	if (callback) {
		return nodeify(self.deleteMessage(uid), callback);
	}

	return new Promise(function (resolve, reject) {
		self.imap.addFlags(uid, '\\Deleted', function (err) {
			if (err) {
				reject(err);
				return;
			}
			self.imap.expunge(function (err) {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	});
};



/**
 * Close a mailbox
 *
 * @param {boolean} [autoExpunge=true] If autoExpunge is true, any messages marked as Deleted in the currently open mailbox will be remove
 * @param {function} [callback] Optional callback, receiving signature (err)
 * @returns {undefined|Promise} Returns a promise when no callback is specified, resolving to `boxName`
 * @memberof ImapSimple
 */
imaps.ImapSimple.prototype.closeBox = function (autoExpunge = true, callback) {
	var self = this;

	if (typeof (autoExpunge) == 'function') {
		callback = autoExpunge;
		autoExpunge = true;
	}

	if (callback) {
		return nodeify(this.closeBox(autoExpunge), callback);
	}

	return new Promise(function (resolve, reject) {

		self.imap.closeBox(autoExpunge, function (err, result) {

			if (err) {
				reject(err);
				return;
			}

			resolve(result);
		});
	});
};


/**
 * Fetches emails from the imap server. It is a facade against the more complicated imap-simple api. It keeps the connection
 * as a member field.
 *
 * With this abstraction it would be easy to replace this with any inbound mail service like mailgun.com.
 */
class ImapService extends EventEmitter {
	constructor(config) {
		super()
		this.config = config

		/**
		 * Set of emitted UIDs. Listeners should get each email only once.
		 * @type {Set<any>}
		 */
		this.loadedUids = new Set()
		this.loadedSentBoxUids = new Set()

		this.connection = null
		this.sentBoxConnection = null
		this.initialLoadDone = false
	}

	async connectAndLoadMessages() {
		const configWithListener = {
			...this.config,
			// 'onmail' adds a callback when new mails arrive. With this we can keep the imap refresh interval very low (or even disable it).
			onmail: () => this._doOnNewMail()
		}

		this.once(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
			this._doAfterInitialLoad()
		)

		await this._connectWithRetry(configWithListener)
		await this._connectsentBoxWithRetry(configWithListener)

		// Load all messages in the background. (ASYNC)
		this._loadMailSummariesAndEmitAsEvents()
		this._loadSentMailSummariesAndEmitAsEvents()
	}

	async _connectWithRetry(configWithListener) {

		try {
			await retry(
				async _bail => {
					if (this.connection) {
						console.log("zaten baglanti var");
					}

					// If anything throws, we retry
					this.connection = await imaps.connect(configWithListener)

					this.connection.on('error', err => {
						// We assume that the app will be restarted after a crash.
						console.error(
							'got fatal error during imap operation, stop app.',
							err
						)
						this.emit('error', err)
					})

					const box = await this.connection.openBox('INBOX')
					console.log("==>" + box.uidvalidity);
					debug('connected to imap')
				},
				{
					retries: 5
				}
			)
		} catch (error) {
			console.error('can not connect, even with retry, stop app', error)
			throw error
		}
	}
	async _connectsentBoxWithRetry(configWithListener) {
		try {
			await retry(
				async _bail => {
					// If anything throws, we retry
					this.sentBoxConnection = await imaps.connect(configWithListener)

					this.sentBoxConnection.on('error', err => {
						// We assume that the app will be restarted after a crash.
						console.error(
							'got fatal error during imap operation, stop app.',
							err
						)
						this.emit('error', err)
					})

					const box = await this.sentBoxConnection.openBox('[Gmail]/Sent Mail')
					console.log(box.uidvalidity);
					debug('connected to imap')
					console.log('connected to imap')
				},
				{
					retries: 5
				}
			)
		} catch (error) {
			console.error('can not connect, even with retry, stop app', error)
			throw error
		}
	}

	_doOnNewMail() {
		console.log("🚀 ~ file: imap-service.js ~ line 187 ~ ImapService ~ _doOnNewMail ~ _doOnNewMail");
		// Only react to new mails after the initial load, otherwise it might load the same mails twice.
		if (this.initialLoadDone) {
			this._loadMailSummariesAndEmitAsEvents()
		}
	}

	_doAfterInitialLoad() {
		// During initial load we ignored new incoming emails. In order to catch up with those, we have to refresh
		// the mails once after the initial load. (async)
		this._loadMailSummariesAndEmitAsEvents()

		// If the above trigger on new mails does not work reliable, we have to regularly check
		// for new mails on the server. This is done only after all the mails have been loaded for the
		// first time. (Note: set the refresh higher than the time it takes to download the mails).
		if (this.config.imap.refreshIntervalSeconds) {
			setInterval(
				() => this._loadMailSummariesAndEmitAsEvents(),
				this.config.imap.refreshIntervalSeconds * 1000
			)
		}
	}

	async _loadMailSummariesAndEmitAsEvents() {
		// UID: Unique id of a message.

		const uids = await this._getAllUids()
		console.log("🚀 ~ file: imap-service.js ~ line 219 ~ ImapService ~ _loadMailSummariesAndEmitAsEvents ~ uids", uids.length);
		const newUids = uids.filter(uid => !this.loadedUids.has(uid))

		// Optimize by fetching several messages (but not all) with one 'search' call.
		// fetching all at once might be more efficient, but then it takes long until we see any messages
		// in the frontend. With a small chunk size we ensure that we see the newest emails after a few seconds after
		// restart.
		const uidChunks = _.chunk(newUids, 20)

		// Creates an array of functions. We do not start the search now, we just create the function.
		const fetchFunctions = uidChunks.map(uidChunk => () =>
			this._getMailHeadersAndEmitAsEvents(uidChunk)
		)

		await pSeries(fetchFunctions)

		if (!this.initialLoadDone) {
			this.initialLoadDone = true
			this.emit(ImapService.EVENT_INITIAL_LOAD_DONE)
		}
	}
	async _loadSentMailSummariesAndEmitAsEvents() {
		// UID: Unique id of a message.

		const uids = await this._getSentBoxAllUids()
		const newUids = uids.filter(uid => !this.loadedSentBoxUids.has(uid))

		// Optimize by fetching several messages (but not all) with one 'search' call.
		// fetching all at once might be more efficient, but then it takes long until we see any messages
		// in the frontend. With a small chunk size we ensure that we see the newest emails after a few seconds after
		// restart.
		const uidChunks = _.chunk(newUids, 20)

		// Creates an array of functions. We do not start the search now, we just create the function.
		const fetchFunctions = uidChunks.map(uidChunk => () =>
			this._getSentBoxMailHeadersAndEmitAsEvents(uidChunk)
		)

		await pSeries(fetchFunctions)

		if (!this.initialLoadDone) {
			this.initialLoadDone = true
			this.emit(ImapService.EVENT_INITIAL_LOAD_DONE)
		}
	}

	/**
	 *
	 * @param {Date} deleteMailsBefore delete mails before this date instance
	 */
	async deleteOldMails(deleteMailsBefore) {
		debug(`deleting mails before ${deleteMailsBefore}`)
		const uids = await this._searchWithoutFetch([
			['!DELETED'],
			['BEFORE', deleteMailsBefore]
		])
		if (uids.length === 0) {
			return
		}

		debug(`deleting mails ${uids}`)
		await this.connection.deleteMessage(uids)
		console.log(`deleted ${uids.length} old messages.`)

		uids.forEach(uid => this.emit(ImapService.EVENT_DELETED_MAIL, uid))
	}

	/**
	 * Helper method because ImapSimple#search also fetches each message. We just need the uids here.
	 *
	 * @param {Object} searchCriteria (see ImapSimple#search)
	 * @returns {Promise<Array<Int>>} Array of UIDs
	 * @private
	 */
	async _searchWithoutFetch(searchCriteria) {
		const imapUnderlying = this.connection.imap

		return new Promise((resolve, reject) => {
			imapUnderlying.search(searchCriteria, (err, uids) => {
				if (err) {
					reject(err)
				} else {
					resolve(uids || [])
				}
			})
		})
	}
	async _searchSentBoxWithoutFetch(searchCriteria) {
		const imapUnderlying = this.sentBoxConnection.imap

		return new Promise((resolve, reject) => {
			imapUnderlying.search(searchCriteria, (err, uids) => {
				if (err) {
					reject(err)
				} else {
					resolve(uids || [])
				}
			})
		})
	}

	_createMailSummary(message) {

		const headerPart = message.parts[0].body
		const { uid, seqNo, struct, envelope } = message.attributes
		const to = parseMailAddress(envelope.to)
		const from = parseMailAddress(envelope.from);
		const senter = parseMailAddress(envelope.senter);
		const replyTo = parseMailAddress(envelope.replyTo);
		const bcc = parseMailAddress(envelope.bcc);
		const cc = parseMailAddress(envelope.cc);
		const subject = headerPart.subject[0]
		const date = headerPart.date[0]
		const inReplyTo = envelope.inReplyTo
		const messageId = envelope.messageId

		const attachments = findAttachmentParts(struct);
		const type = Array.isArray(struct) ? struct[0].type : null;
		let caseInfo;
		let emailId;
		let mail = Mail.create(to, from, date, subject, uid, senter, cc, bcc, inReplyTo, attachments, seqNo, type, caseInfo, emailId, replyTo, messageId);
		return mail
	}

	async fetchOneFullMail(box, to, uid) {

		if (!this.connection) {
			// Here we 'fail fast' instead of waiting for the connection.
			throw new Error('imap connection not ready')
		}

		debug(`fetching full message ${uid}`)

		// For security we also filter TO, so it is harder to just enumerate all messages.
		const searchCriteria = [['UID', uid], ['TO', to]]
		const fetchOptions = {
			bodies: ['HEADER', ''], // Empty string means full body
			markSeen: false
		}

		let messages;
		if (box === "inbox") {
			messages = await this.connection.search(searchCriteria, fetchOptions)
		}
		else {
			messages = await this.sentBoxConnection.search(searchCriteria, fetchOptions)
		}
		if (messages.length === 0) {
			throw new Error('email not found')
		}
		const fullBody = _.find(messages[0].parts, { which: '' })
		return simpleParser(fullBody.body)
	}

	async _getAllUids() {
		// We ignore mails that are flagged as DELETED, but have not been removed (expunged) yet.
		const uids = await this._searchWithoutFetch([['!DELETED']])
		// Create copy to not mutate the original array. Sort with newest first (DESC).
		return [...uids].sort().reverse()
	}
	async _getSentBoxAllUids() {
		// setTimeout(this.throwException, 15000)
		// We ignore mails that are flagged as DELETED, but have not been removed (expunged) yet.
		const uids = await this._searchSentBoxWithoutFetch([['!DELETED']])
		// Create copy to not mutate the original array. Sort with newest first (DESC).
		return [...uids].sort().reverse()
	}
	async _getMailHeadersAndEmitAsEvents(uids) {
		try {
			const mails = await this._getMailHeaders(uids)
			mails.forEach(mail => {
				this.loadedUids.add(mail.attributes.uid)
				// Some broadcast messages have no TO field. We have to ignore those messages.
				if (mail.parts[0].body.to) {
					this.emit(ImapService.EVENT_NEW_MAIL, this._createMailSummary(mail))
				}
			})
		} catch (error) {
			debug('can not fetch', error)
			throw error
		}
	}
	async _getSentBoxMailHeadersAndEmitAsEvents(uids) {
		try {
			const mails = await this._getSentBoxMailHeaders(uids)
			mails.forEach(mail => {
				this.loadedSentBoxUids.add(mail.attributes.uid)
				// Some broadcast messages have no TO field. We have to ignore those messages.
				if (mail.parts[0].body.to) {
					this.emit(ImapService.EVENT_NEW_SENT_MAIL, this._createMailSummary(mail))
				}
			})
		} catch (error) {
			debug('can not fetch', error)
			throw error
		}
	}
	async _getMailHeaders(uids) {
		const fetchOptions = {
			bodies: ["HEADER"],
			flags: true,
			envelope: true,
			uid: true,
			struct: true,
		}
		// const fetchOptions = {
		// 	bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
		// 	struct: false
		// }
		const searchCriteria = [['UID', ...uids]]
		return this.connection.search(searchCriteria, fetchOptions)
	}
	async _getSentBoxMailHeaders(uids) {
		const fetchOptions = {
			bodies: ["HEADER"],
			flags: true,
			envelope: true,
			uid: true,
			struct: true,
		}
		// const fetchOptions = {
		// 	bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
		// 	struct: false
		// }
		const searchCriteria = [['UID', ...uids]]
		return this.sentBoxConnection.search(searchCriteria, fetchOptions)
	}
	throwException = () => {
		console.log("====>", "tamam");
		this.connection.end;
		this.emit(ImapService.EVENT_ERROR)
	}
}

findAttachmentParts = (struct, attachments) => {
	attachments = attachments || [];
	for (var i = 0, len = struct.length, r; i < len; ++i) {
		if (Array.isArray(struct[i])) {
			findAttachmentParts(struct[i], attachments);
		} else if (struct[i].disposition && ["INLINE", "ATTACHMENT"].indexOf(toUpper(struct[i].disposition.type)) > -1) {
			// attachments.push(struct[i]);
			const attachmentDetail = new Attachment(struct[i].partID, struct[i].params.name, struct[i].type, struct[i].subtype, struct[i].encoding, struct[i].size);
			attachments.push(attachmentDetail);
		}
	}
	return attachments;
};
parseMailAddress = (adresArray) => {
	if (Array.isArray(adresArray)) {
		adresArray.map((fromObj) => {
			fromObj.address = `${fromObj.mailbox}@${fromObj.host}`;
			return fromObj;
		});
	}
	return adresArray;
};
// Consumers should use these constants:
ImapService.EVENT_NEW_MAIL = 'mail'
ImapService.EVENT_NEW_SENT_MAIL = 'sent_mail'
ImapService.EVENT_DELETED_MAIL = 'mailDeleted'
ImapService.EVENT_INITIAL_LOAD_DONE = 'initial load done'
ImapService.EVENT_INITIAL_LOAD_SENT_DONE = 'initial load sent box done'
ImapService.EVENT_ERROR = 'error'

module.exports = ImapService
