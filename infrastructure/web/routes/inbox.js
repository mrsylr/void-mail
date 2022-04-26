const express = require('express')

const router = new express.Router()
const { sanitizeParam } = require('express-validator/filter')
const fs = require('fs');
const sanitizeAddress = sanitizeParam('address').customSanitizer(
	(value, { req }) => {
		return req.params.address
			.replace(/[^A-Za-z0-9_.+@-]/g, '') // Remove special characters
			.toLowerCase()
	}
)

router.get('^/get/:box/:address([^@/]+@[^@/]+)', sanitizeAddress, (req, res, _next) => {
	const ConnectionsArray = req.app.get('ConnectionsArray')
	const mailProcessingService = ConnectionsArray["cfnteknoloji@gmail.com"].mailProcessingService
	const mailSummaries = mailProcessingService.getMailSummaries("cfnteknoloji@gmail.com" + "_" + req.params.box);
	// console.log("🚀 ~ file: inbox.js ~ line 18 ~ router.get ~ mailSummaries", mailSummaries);
	// const mailSummaries = mailProcessingService.getMailSummaries();
	// const mail = mailProcessingService.saveToFile(
	// 	req.params.address,
	// )
	fs.writeFileSync('/tmp/mailRepo_' + req.params.box, JSON.stringify(mailSummaries));
	res.render('inbox', {
		title: req.params.address,
		address: req.params.address,
		mailSummaries
	})
})

router.get(
	'^/get/:box/:address/:uid([0-9]+$)',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const ConnectionsArray = req.app.get('ConnectionsArray')
			const mailProcessingService = ConnectionsArray["cfnteknoloji@gmail.com"].mailProcessingService
			const mail = await mailProcessingService.getOneFullMail(
				req.params.box,
				req.params.address,
				req.params.uid
			)
			if (mail) {
				// Emails are immutable, cache if found
				res.set('Cache-Control', 'private, max-age=600')
				res.render('mail', {
					title: req.params.address,
					address: req.params.address,
					mail
				})
			} else {
				next({ message: 'email not found', status: 404 })
			}
		} catch (error) {
			console.error('error while fetching one email', error)
			next(error)
		}
	}
)
router.get(
	'^/save/:address',
	sanitizeAddress,
	async (req, res, next) => {
		// const mailProcessingService = req.app.get('mailProcessingService')
		console.log("🚀 ~ file: inbox.js ~ line 59 ~ mailProcessingService", req.app);
		// const mail = await mailProcessingService.saveToFile(
		// 	req.params.address,
		// )


		res.render("<div>Het</>");
	});

module.exports = router
