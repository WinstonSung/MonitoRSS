const config = require('../config.json')
const storage = require('./storage.js')
const currentGuilds = storage.currentGuilds
const TEST_OPTIONS = {split: {prepend: '```md\n', append: '```'}}
const log = require('./logger.js')
const debugFeeds = require('./debugFeeds').list
const translate = require('../rss/translator/translate.js')
const deletedFeeds = storage.deletedFeeds

class ArticleMessage {
  constructor (article, isTestMessage, skipFilters) {
    this.article = article
    this.isTestMessage = isTestMessage
    this.skipFilters = skipFilters || isTestMessage
    this.channel = storage.bot.channels.get(article.discordChannelId)
    this.guildRss = currentGuilds.get(this.channel.guild.id)
    this.webhook = undefined
    this.sendFailed = 1
    this.rssName = article.rssName
    this.valid = true
    if (!this.guildRss) {
      this.valid = false
      return log.general.error(`${this.rssName} Unable to initialize an ArticleMessage due to missing guild profile`, this.channel.guild)
    }
    this.source = this.guildRss ? this.guildRss.sources[this.rssName] : undefined
    if (!this.source) {
      this.valid = false
      return log.general.error(`${this.rssName} Unable to initialize an ArticleMessage due to missing source`, this.channel.guild, this.channel)
    }
    this.split = this.source.splitMessage // The split options if the message exceeds the character limit. If undefined, do not split, otherwise it is an object with keys char, prepend, append
  }

  _resolveChannel (callback) {
    if (((config.advanced._restrictWebhooks === true && storage.vipServers[this.channel.guild.id] && storage.vipServers[this.channel.guild.id].benefactor.allowWebhooks) || !config.advanced._restrictWebhooks) && this.source && typeof this.source.webhook === 'object') {
      if (!this.channel.guild.me.permissionsIn(this.channel).has('MANAGE_WEBHOOKS')) return this._translate(undefined, callback)
      this.channel.fetchWebhooks().then(hooks => {
        const hook = hooks.get(this.source.webhook.id)
        if (!hook) return this._translate(undefined, callback)
        const guildId = this.channel.guild.id
        const guildName = this.channel.guild.name
        this.webhook = hook
        this.webhook.guild = { id: guildId, name: guildName }
        this.webhook.name = this.source.webhook.name ? this.source.webhook.name : undefined
        this.webhook.avatar = this.source.webhook.avatar ? this.source.webhook.avatar : undefined
        this._translate(undefined, callback)
      }).catch(err => {
        log.general.warning(`Cannot fetch webhooks for ArticleMessage webhook initialization to send message`, this.channel, err, true)
        this._translate(undefined, callback)
      })
    } else this._translate(undefined, callback)
  }

  _translate (ignoreLimits, callback) {
    const results = translate(this.guildRss, this.rssName, this.article, this.isTestMessage, ignoreLimits)
    this.passedFilters = results.passedFilters
    this.testDetails = results.testDetails
    this.embed = results.embed
    this.text = results.text
    if (callback) callback()
  }

  send (callback) {
    this._resolveChannel(() => {
      if (!this.valid) return callback(new Error(`Missing ArticleMessage initialization data`))
      if (!this.skipFilters && !this.passedFilters) {
        if (config.log.unfiltered === true) log.general.info(`'${this.article.link ? this.article.link : this.article.title}' did not pass filters and was not sent`, this.channel)
        return callback()
      }
      if (deletedFeeds.includes(this.rssName)) return callback(new Error(`${this.rssName} for channel ${this.channel.id} was deleted during cycle`))

      // Set up the send options
      const textContent = this.isTestMessage ? this.testDetails : this.text.length > 1950 && !this.split ? `Error: Feed Article could not be sent for ${this.article.link} due to a single message's character count >1950.` : this.text.length === 0 && !this.embed ? `Unable to send empty message for feed article <${this.article.link}>.` : this.text
      const options = this.isTestMessage ? TEST_OPTIONS : {}
      if (this.webhook) {
        options.username = this.webhook.name
        options.avatarURL = this.webhook.avatar
      }
      if (!this.isTestMessage && this.embed) {
        if (this.webhook) options.embeds = [this.embed]
        else options.embed = this.embed
      }
      if (!this.isTestMessage) options.split = this.split

      // Send the message, and repeat attempt if failed
      const medium = this.webhook ? this.webhook : this.channel
      medium.send(textContent, options)
      .then(m => {
        if (this.isTestMessage) {
          this.isTestMessage = false
          this.send(callback)
        } else callback()
      })
      .catch(err => {
        if (this.split && err.message.includes('no split characters')) {
          this._translate(false) // Retranslate with the character limits for individual placeholders again
          return this.send(callback)
        }
        if (err.code === 50013 || this.sendFailed++ === 4) { // 50013 = Missing Permissions
          if (debugFeeds.includes(this.rssName)) log.debug.error(`${this.rssName}: Message has been translated but could not be sent (TITLE: ${this.article.title})`, err)
          return callback(err)
        }
        setTimeout(() => this.send.bind(this)(callback), 500)
      })
    })
  }
}

module.exports = ArticleMessage