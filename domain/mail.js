class Mail {
	constructor(to, from, date, subject, uid, sender, cc, bcc, inReplyTo, attachments, seqNo, type, caseInfo, emailId, replyTo, messageId) {
		this.date = date
		this.subject = subject
		this.from = from
		this.sender = sender
		this.replyTo = replyTo
		this.to = to
		this.cc = cc
		this.bcc = bcc
		this.inReplyTo = inReplyTo
		this.attachments = attachments
		this.seqNo = seqNo
		this.type = type
		this.caseInfo = caseInfo
		this.emailId = emailId
		this.uid = uid
		this.replyTo = replyTo
		this.messageId = messageId
	}

	static create(to, from, date, subject, uid, sender, cc, bcc, inReplyTo, attachments, seqNo, type, caseInfo, emailId, replyTo, messageId) {
		return new Mail(to, from, date, subject, uid, sender, cc, bcc, inReplyTo, attachments, seqNo, type, caseInfo, emailId, replyTo, messageId)
	}


}

module.exports = Mail
