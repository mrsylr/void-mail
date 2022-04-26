const express = require('express')

const router = new express.Router()
const randomWord = require('random-word')
const { check, validationResult } = require('express-validator/check')
const config = require('../../../application/config')

router.get('/', (req, res, _next) => {
	res.render('login', {
		title: 'Login',
		username: "cfnteknoloji@gmail.com",
		domain: config.email.domain
	})
})

router.get('/random', (req, res, _next) => {
	res.redirect(`/get/inbox/cfnteknoloji@gmail.com`)
})

router.post(
	'/',
	[
		check('username').isLength({ min: 1 }),
		check('domain').isIn([config.email.domain])
	],
	(req, res) => {
		const errors = validationResult(req)
		if (!errors.isEmpty()) {
			return res.render('login', {
				title: 'Login',
				username: req.body.username,
				domain: config.email.domain,
				userInputError: true
			})
		}

		res.redirect(`/get/inbox/${req.body.username}@${req.body.domain}`)
	}
)

module.exports = router
