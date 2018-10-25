const Botmock = require('botkit-mock');
const backpop = require('../../commands/backpop');


describe('backpop',()=>{
  let channelsInSlack = [
    { name: 'sk-happy-elephant', id: 'caseChannel1' },
    { name: 'sk-dancing-pigeon', id: 'caseChannel2' },
    { name: 'general',           id: 'nonCaseChannel' },
  ]

  let expectedBackpopped = [
    { name: 'sk-happy-elephant', id: 'caseChannel1' },
    { name: 'sk-dancing-pigeon', id: 'caseChannel2' },
  ]

  beforeEach(()=>{
    this.controller = Botmock({});

    this.bot = this.controller.spawn({type: 'slack'});
    this.bot.config.bot = { app_token: 'some_token' }

    this.bot.api.channels.list = jest.fn(({}, callback)=>{
      return callback(null, {channels: channelsInSlack})
    })

    // Ensure records don't already exist in db
    channelsInSlack.map((channel)=>{
      this.controller.storage.channels.get(channel.id, (err,chan)=>{
        expect(err || !chan).toBeTruthy()
      })
    })
  })

  it('saves channels from the bot API to controller storage',()=>{
    backpop.call(this.controller, this.bot, '12345')
    expectedBackpopped.map((channel)=>{
      this.controller.storage.channels.get(channel.id, (err,chan)=>{
        expect(chan.id).toBe(channel.id)
        expect(chan.name).toBe(channel.name)
        expect(chan.team_id).toBe('12345')
      })
    })
  })
})