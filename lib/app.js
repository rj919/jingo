#!/usr/bin/env node

/*
 * Jingo, wiki engine
 * http://github.com/claudioc/jingo
 *
 * Copyright 2013-2017 Claudio Cicali <claudio.cicali@gmail.com>
 * Released under the MIT license
 */

var express = require('express')
var path = require('path')
var components = require('./components')
var wikiStatic = require('./wikistatic')
var favicon = require('serve-favicon')
var session = require('express-session')
var bodyParser = require('body-parser')
var expValidator = require('express-validator')
var cookieParser = require('cookie-parser')
var logger = require('morgan')
var program = require('commander')
var cookieSession = require('cookie-session')
var gravatar = require('gravatar')
var passport = require('passport')
var methodOverride = require('method-override')
var flash = require('express-flash')
var fs = require('fs') // MOD import dependency for media folder mapping

var app

module.exports.getInstance = function () {
  if (!app) {
    throw new Error('Cannot get an instance of an unitialized App')
  }
  return app
}

module.exports.initialize = function (config) {
  app = express()

  app.locals.config = config

  app.locals.baseUrl = '//' + config.get('server').hostname + ':' + config.get('server').port

  if (config.get('server').baseUrl === '') {
    app.locals.baseUrl = '//' + config.get('server').hostname + ':' + config.get('server').port
  } else {
    app.locals.baseUrl = config.get('server').baseUrl
  }

  // MOD add assets to locals
  app.locals.assets = {
    css: [],
    js: []
  }
  var cssArray = config.get('assets').css.split(',')
  for (var i = 0; i < cssArray.length; i++){
    if (cssArray[i].trim() && fs.existsSync(Git.mediaPath(cssArray[i].trim()))){
      app.locals.assets.css.push(cssArray[i].trim())
    }
  }
  var jsArray = config.get('assets').js.split(',')
  for (var i = 0; i < jsArray.length; i++){
    if (jsArray[i].trim() && fs.existsSync(Git.mediaPath(jsArray[i].trim()))){
      app.locals.assets.js.push(jsArray[i].trim())
    }
  }
  if (app.locals.assets.css){
    console.log('Adding styles ' + JSON.stringify(app.locals.assets.css))
  }
  if (app.locals.assets.js){
    console.log('Adding scripts ' + JSON.stringify(app.locals.assets.js))
  }
  
  // View helpers
  app.use(function (req, res, next) {
    res.locals = {
      get user () {
        return req.user
      },
      get appBrand () {
        var appTitle = config.get('application').title || ''
        var appLogo = config.get('application').logo || ''
        if (appLogo !== '') {
          appLogo = '<img src="' + appLogo + '" alt="Logo">'
        }
        return appLogo + ' ' + appTitle
      },
      get proxyPath () {
        return config.getProxyPath()
      },
      get jingoVersion () {
        return program.version()
      },
      get authentication () {
        return config.get('authentication')
      },
      get faviconMimeType () {
        if (!this.hasFavicon()) {
          return ''
        }
        var favicon = config.get('application').favicon.trim()
        var match = favicon.match(/\.([0-9a-z]+)$/i)
        return match ? 'image/' + match[1] : 'image/png'
      },
      get faviconUrl () {
        if (!this.hasFavicon()) {
          return ''
        }
        return config.get('application').favicon.trim()
      },
      // MOD add layout configuration to locals
      get sidebarWidth () {
        return config.get('layout').sidebarWidth.toString()
      },
      get mainWidth () {
        return config.get('layout').mainWidth.toString()
      },
      get footerWidth () {
        return config.get('layout').footerWidth.toString()
      },
      get footerSidebarWidth () {
        return (12 - config.get('layout').footerWidth).toString()
      },
      get sidebarMobile () {
        return config.get('layout').sidebarMobile
      },
      // MOD add redaction and page summary toggles
      get redactEnabled () {
        return config.get('redaction').enabled
      },
      get redactContent () {
        return config.get('redaction').enabled && !req.user
      },
      get pageSummaries () {
        return config.get('features').pageSummaries
      },
      // MOD add serve local toggle
      get serveLocal () {
        return config.get('application').serveLocal
      },
      // MOD add asset imports
      get cssAssets () {
        return app.locals.assets.css
      },
      get jsAssets () {
        return app.locals.assets.js
      },

      isAnonymous: function () {
        return !req.user
      },
      canSearch: function () {
        return !!req.user || app.locals.config.get('authorization').anonRead
      },
      gravatar: function (email) {
        return gravatar
      },
      hasGravatar: function () {
        return config.get('features').gravatar && req.user && req.user.email && req.user.email !== 'jingouser'
      },
      hasFavicon: function () {
        return config.get('application').favicon && config.get('application').favicon.trim().length > 0
      },
      get isAjax () {
        return req.headers['x-requested-with'] && req.headers['x-requested-with'] === 'XMLHttpRequest'
      }
    }
    next()
  })

  app.locals.coalesce = function (value, def) {
    return typeof value === 'undefined' ? def : value
  }

  app.locals.pretty = true // Pretty HTML output from Pug

  app.locals.hasSidebar = components.hasSidebar
  app.locals.hasFooter = components.hasFooter
  app.locals.hasCustomStyle = components.hasCustomStyle
  app.locals.hasCustomScript = components.hasCustomScript
  app.locals.hasFeature = function (feature) {
    return !!app.locals.config.get('features')[feature]
  }

  if (components.hasCustomStyle()) {
    console.log('Using custom style ' + config.get('customizations')['style'])
  }

  if (components.hasCustomScript()) {
    console.log('Using custom script ' + config.get('customizations')['script'])
  }

  app.enable('trust proxy')
  if (config.get('application').loggingMode) {
    app.use(logger(config.get('application').loggingMode == 1 ? 'combined' : 'dev', {skip: function () { }})) // eslint-disable-line eqeqeq
  }
  app.use(favicon(path.join(__dirname + '/../', 'public', 'favicon.ico'))) // eslint-disable-line no-path-concat
  app.use(bodyParser.urlencoded({extended: true, limit: '500kb'}))
  app.use(methodOverride(function (req, res) {
    if (req.body && typeof req.body === 'object' && '_method' in req.body) {
      // look in urlencoded POST bodies and delete it
      var method = req.body._method
      delete req.body._method
      return method
    }
  }))
  // MOD add files in media path to static files
  if (Git.mediaPath()) {
    app.use(express.static(Git.mediaPath()))
  }
  app.use(express.static(path.join(__dirname + '/../', 'public'))) // eslint-disable-line no-path-concat
  app.use(cookieParser())
  app.use(cookieSession({
    name: 'JingoSession',
    keys: ['jingo'],
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
  }))
  app.use(session({ name: 'jingosid',
    secret: config.get('application').secret,
    cookie: { httpOnly: true },
    saveUninitialized: true,
    resave: true
  }))
  app.use(flash())
  app.use(expValidator())

  app.set('views', __dirname + '/../views') // eslint-disable-line no-path-concat
  app.set('view engine', 'pug')

  // Read this before disabling it https://github.com/strongloop/express/pull/2813#issuecomment-159270428
  app.set('x-powered-by', true)

  app.use(function (req, res, next) {
    res.locals._style = components.customStyle()
    res.locals._script = components.customScript()

    if (/^\/auth\//.test(req.url) ||
        /^\/misc\//.test(req.url) ||
        (/^\/login/.test(req.url) && !config.get('authorization').anonRead)
    ) {
      return next()
    }

    components.sidebarAsync().then(function (content) {
      res.locals._sidebar = content
      return components.footerAsync()
    }).then(function (content) {
      res.locals._footer = content
      return next()
    }).catch(function (e) {
      console.log(e)
    })
  })

  app.use(passport.initialize())
  app.use(passport.session())

  app.locals.passport = passport

  function requireAuthentication (req, res, next) {
    if (!res.locals.user) {
      res.redirect(res.locals.proxyPath + '/login')
    } else {
      next()
    }
  }

  app.all('/pages/*', requireAuthentication)

  if (!app.locals.config.get('authorization').anonRead) {
    app.all('/wiki', requireAuthentication)
    app.all('/wiki/*', requireAuthentication)
    app.all('/search', requireAuthentication)
  }

  app.use('/wiki', wikiStatic.configure())

  app.use(require('../routes/wiki'))
    .use(require('../routes/pages'))
    .use(require('../routes/search'))
    .use(require('../routes/auth'))
    .use(require('../routes/misc'))

  // Server error
  app.use(function (err, req, res, next) {
    res.locals.title = '500 - Internal server error'
    res.statusCode = 500
    console.log(err)
    res.render('500.pug', {
      message: 'Sorry, something went wrong and I cannot recover. If you think this might be a bug in Jingo, please file a detailed report about what you were doing here: https://github.com/claudioc/jingo/issues . Thank you!',
      error: err
    })
  })

  return app
}
