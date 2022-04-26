const EventEmitter = require('events')
const debug = require('debug')('void-mail:imap-manager')
const mem = require('mem')
const util = require('util')
const moment = require('moment')
const ImapService = require('./imap-service')

class MailProcessingService extends EventEmitter {
	constructor(mailRepository, imapService, clientNotification, config) {
		super()
		this.mailRepository = mailRepository
		this.clientNotification = clientNotification
		this.imapService = imapService
		this.config = config
		this.mailAccount = config.imap.user;
		// Cached methods:
		this.cachedFetchFullMail = mem(
			this.imapService.fetchOneFullMail.bind(this.imapService),
			{ maxAge: 10 * 60 * 1000 }
		)

		this.initialLoadDone = false
		this.initialLoadSentBoxDone = false

		// Delete old messages now and every few hours
		this.imapService.once(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
			this._deleteOldMails()
		)
		setInterval(() => this._deleteOldMails(), 1000 * 3600 * 6)
	}

	getMailSummaries(address) {

		return this.mailRepository.getForRecipient(address)
	}

	getOneFullMail(box, address, uid) {
		return this.cachedFetchFullMail(box, address, uid)
	}

	getAllMailSummaries() {
		return this.mailRepository.getAll()
	}

	onInitialLoadDone() {
		this.initialLoadDone = true
		console.log(
			`initial load done, got ${this.mailRepository.mailCount()} mails`
		)
		// console.log(util.inspect(this.mailRepository, { showHidden: false, depth: null, colors: true }))
	}
	onInitialLoadSentBoxDone() {
		this.initialLoadSentBoxDone = true
		console.log(this.mailRepository,
			`initial load sent box done, got ${this.mailRepository.mailCount()} mails`
		)
	}

	onNewMail(mail) {
		if (this.initialLoadDone) {
			// For now, only log messages if they arrive after the initial load
			debug('new mail for', mail.to[0])
		}
		this.mailRepository.add(this.mailAccount, mail);
		return this.clientNotification.emit(this.mailAccount);
	}
	onNewSentMail(mail) {
		if (this.initialLoadSentBoxDone) {
			// For now, only log messages if they arrive after the initial load
			debug('new mail for', mail.to[0])
		}
		this.mailRepository.addSentBox(this.mailAccount, mail);
		return this.clientNotification.emit(this.mailAccount);
	}

	onMailDeleted(uid) {
		debug('mail deleted with uid', uid)
		this.mailRepository.removeUid(uid)
		// No client notification required, as nobody can cold a connection for 30+ days.
	}

	async _deleteOldMails() {
		try {
			await this.imapService.deleteOldMails(
				moment()
					.subtract(this.config.email.deleteMailsOlderThanDays, 'days')
					.toDate()
			)
		} catch (error) {
			console.log('can not delete old messages', error)
		}
	}

	saveToFile(address) {
		// console.log("🚀 ~ file: mail-processing-service.js ~ line 94 ~ MailProcessingService ~ saveToFile ~ address", address);
		// const fs = require('fs')
		// fs.writeFile(filename, JSON.stringify(mails), err => {
		// 	if (err) {
		// 		console.error('can not save mails to file', err)
		// 	}
		// })
		this.mailRepository.saveToFile(address);
	}
}

module.exports = MailProcessingService
