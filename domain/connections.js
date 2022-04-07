
const ClientNotification = require('../infrastructure/web/client-notification')
const ImapService = require('../application/imap-service')
const MailProcessingService = require('../application/mail-processing-service')
const MailRepository = require('../domain/mail-repository')
const { app, io, server } = require('../infrastructure/web/web')

class Connections {
    constructor(config) {
        this.imapService = new ImapService(config)
        const clientNotification = new ClientNotification()
        this.clientNotification = clientNotification
        this.clientNotification.use(io);
        this.mailProcessingService = new MailProcessingService(
            new MailRepository(),
            this.imapService,
            this.clientNotification,
            config
        )

        // Put everything together:
        this.imapService.on(ImapService.EVENT_NEW_MAIL, mail =>
            this.mailProcessingService.onNewMail(mail)
        )
        this.imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
            this.mailProcessingService.onInitialLoadDone()
        )
        this.imapService.on(ImapService.EVENT_DELETED_MAIL, mail =>
            this.mailProcessingService.onMailDeleted(mail)
        )

        this.mailProcessingService.on('error', err => {
            console.error('error from mailProcessingService, stopping.', err)
            process.exit(1)
        })

        this.imapService.on(ImapService.EVENT_ERROR, error => {
            console.error('fatal error from imap service', error)
            process.exit(1)
        })
        this.imapService.connectAndLoadMessages().catch(error => {
            console.error('fatal error from imap service', error)
            process.exit(1)
        })
    }

    static create(config) {
        return new Connections(config)
    }
}

module.exports = Connections
