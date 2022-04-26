
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
        this.retry = 0;

        // Put everything together:
        this.imapService.on(ImapService.EVENT_NEW_MAIL, mail =>
            this.mailProcessingService.onNewMail(mail)
        )
        // Put everything together:
        this.imapService.on(ImapService.EVENT_NEW_SENT_MAIL, mail =>
            this.mailProcessingService.onNewSentMail(mail)
        )
        this.imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () =>

            this.mailProcessingService.onInitialLoadDone()

        )
        this.imapService.on(ImapService.EVENT_INITIAL_LOAD_SENT_DONE, () =>
            this.mailProcessingService.onInitialLoadSentBoxDone()
        )
        this.imapService.on(ImapService.EVENT_DELETED_MAIL, mail =>
            this.mailProcessingService.onMailDeleted(mail)
        )

        this.mailProcessingService.on('error', err => {
            console.error('error from mailProcessingService, stopping.', err)
            process.exit(1)
        })

        this.imapService.on(ImapService.EVENT_ERROR, error => {
            console.error('I got an error', error)

            if (this.retry === 20) {
                console.error('Bitti ====================================================>')
                console.error('error from mailProcessingService, stopping.')
                process.exit(1)
            } else {
                console.error('Bi daha dene')
                this.retry += 1;
                this.imapService.connectAndLoadMessages().catch(error => {
                    console.error('fatal error from imap service on error', error)
                    process.exit(1)
                })
            }


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
