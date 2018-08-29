const VERIFY_TOKEN = process.env.verificationToken

function addZero(i) {
    if (i < 10) {
        i = "0" + i;
    }
    return i;
}

function friendlyDate(date) {
  return (staticSpaces(date.getMonth() + 1, 2, true) + "/"
         + staticSpaces(date.getDate(), 2) + " " 
         + staticSpaces(addZero(date.getHours()), 2, true) + ':'
         + addZero(date.getMinutes())
         );
}

function staticSpaces(string, targetLength, atBeginning) {
  var lead = Array(Math.max(0, targetLength - String(string).length)).join(' ')
  return (atBeginning ? (lead + string) : (string + lead) );
}

function tableFormat(channelList) {
  var formattedList = channelList.map(function(chan) {
    if (chan.store && chan.store.assignment) {
      var assignee = "<@" + chan.store.assignment+ ">"
    } else {
      var assignee = ""
    }
    return (staticSpaces((chan.lastFrom || ''), 11)
            + staticSpaces(chan.lastTime ? friendlyDate(chan.lastTime) : '', 15)
            + staticSpaces((chan.label || '' ),20)
            + staticSpaces((assignee),20)
            + "<#"+chan.id+">"
           );
  })
  var finalMessage = ('```' +"Open Cases:\n"
                      + staticSpaces('Last Message', 25) + staticSpaces("Flag",20) + staticSpaces("Assignee",20) + 'Channel\n'
                      + formattedList.join("\n") + '```');
  return finalMessage
}

function attachmentFormat(channelList) {
  var formattedList = channelList.map(function(chan) {
    // colors:
    // 1. assigned [green] #00f566
    // 2. patient last spoke [yellow] #f5c400
    // 3. needs attention [orange] #f35a00
    // 4. unassigned & patient last spoke [red] #f50056
    var color = '#00f566' // green
    if (chan.lastFrom === 'patient') {
      color = '#f5c400' //yellow
    }
    if (chan.label === 'needs attention') {
      color = '#f35a00' //orange
    }
    var assignee = ''
    if (chan.store && chan.store.assignment) {
      assignee = "<@" + chan.store.assignment+ ">"
    } else {
      color = '#f50056'
    }
    return {
      fields: [
        { title: ((chan.lastFrom || '')
                  + ' ' + (chan.lastTime ? friendlyDate(chan.lastTime) : '')
                  + (chan.label ? ' (' + chan.label + ')' : '')
                 ),
          value: (assignee || 'unassigned'),
          short: true
        }, {
          title: "Channel",
          value: "<#"+chan.id+">",
          short: true
        }
      ],
      color: color
    }
  })
  return {
    attachments: formattedList
  }
}

function get_channel_history(channel, bot, cb) {
  // https://github.com/howdyai/botkit/issues/840 : overwriting bot_token with app_token
  bot.api.channels.history({token: bot.config.bot.app_token,
                            channel: channel.id,
                            count: 30,
                            unreads: true},
                            cb);
}

function channelSummary(channel, history, flags) {
  // returns {lastFrom: ('patient'|'volunteer'),
  //          lastTime: Date(last_message)
  //          volunteer: <volunteer handle>
  //         }
  // assumes history is in reverse chronological order
  var summary = {'id': channel.id,
                 'name': channel.name
                };
  if (flags && flags.label) {
    summary.label = flags.label
  }
  if (history && history.messages) {
    for (var i=0,l=history.messages.length; i<l; i++) {
      var h = history.messages[i];
      if (h.subtype === 'bot_message') {
        if (/replied/.test(h.username)) {
          summary.lastFrom = 'volunteer'
          summary.volunteer = h.username.replace(' replied', '')
        } else if (h.attachments && /\/sk/.test((h.attachments[0]||{}).text || '')) {
          summary.lastFrom = 'patient'
        }
        if (summary.lastFrom) {
          summary.lastTime = new Date(Number(h.ts) * 1000)
          return summary
        }
      }
    }
  }
  return summary
}

function getTeamChannelsData(controller, bot, message, cb) {
  bot.api.channels.list({},function(err,response) {
    getChannelsWithFlags(controller, bot, message, function(flagErr, knownChannelDict) {
      var historiesTodo = response.channels.length;
      var histories = {}
      response.channels.map(function(ch) {
        get_channel_history(ch, bot, function(historyErr, chHistory) {
          if (!historyErr) {
            histories[ch.id] = chHistory;
          }
          --historiesTodo;
          // Here we have marshalled all the histories, and now we can
          // show the status for each
          if (historiesTodo <= 0) {
            var returnValue = response.channels.map(function(ch){
              var history = histories[ch.id]
              var store = knownChannelDict[ch.id]
              var summary = channelSummary(ch, history, store)
              summary.api = ch
              summary.history = history
              summary.store = store
              return summary
            })
            cb(returnValue)
          }
        })
      })
    })
  })
}


function open_cases(controller, bot, message, formatter) {
  /* Should display something like this!
    CHANNEL              LAST_MESSAGE (sorted) FLAG
    #sk-foo-bar          vol 16:01 9/17 (new)  needs attention
    #sk-happy-bear       pat 12:56 9/16
    #sk-hopeful-panda    vol  9:00 9/17        minor

    Options on /opencases:
    /opencases new (just new ones)
    /opencases flag
   */
  getTeamChannelsData(controller, bot, message, function(channelList) {
    var openChannelList = [];
    for (var i = 0; i < channelList.length; i++) {
      var channel = channelList[i];
      if (/^sk-/.test(channel.api.name)){
        var new_channel = channel.api.num_members == 1, // channels that only have 1 member in them are brand new - that member is the one integrated with Smooch.
            unanswered = (channel.lastFrom && channel.lastFrom == 'patient'), // patient was the last to respond
            inactive = (!channel.lastTime || (new Date() - channel.lastTime) > (60*60*24*1000*7)), // no activity for a week
            flagged = !!(channel.store && channel.store.label)
        if (!channel.api.is_archived ) {
        // if ((new_channel || unanswered || flagged || inactive) && !channel.is_archived ) {
          openChannelList.push(channel);
        }
      }
    }
    var finalMessage = "There are no open cases right now."
    if (openChannelList.length > 0) {
      finalMessage = formatter(openChannelList)
    }
    bot.replyPublic(message, finalMessage)
  });
}

function setCaseAssignment(controller, message, channel, volunteer, cb) {
  setChannelProperty(controller, message, 'assignment', volunteer, function(err, chan) {
    cb(err, chan)
  }, (channel && channel.id))
}

function assign_case(controller, bot, message, channel) {
  var volunteer = (message.text.match(/\<\@(\w+)/) || [message.user_id]).pop()
  setCaseAssignment(controller, message, channel || null, volunteer, function(err, chan) {
    if (chan) {
      bot.replyPublic(message, '<@'+volunteer+'> assigned to <#'+chan.id+'>')
    }
  });
}

function next_case(controller, bot, message) {
  var volunteer = (message.text.match(/\<\@(\w+)/) || [message.user_id]).pop()
  getTeamChannelsData(controller, bot, message, function(channels) {
    channels.sort(function(a,b) {return ((b.lastTime || 0) - (a.lastTime || 0)) })
    var needsAssign = channels.filter(function(ch) {
      return (!(ch.store && ch.store.assigned) && !ch.api.is_archived && /^sk-/.test(ch.api.name))
    });
    if (needsAssign.length) {
      assign_case(controller, bot, message, needsAssign[0])
    } else {
      bot.replyPublic(message, 'No current cases need assignment');
    }
  })

}

function setChannelProperty(controller, message, property, value, cb, channel_id) {
  channel_id = channel_id || (message.text.match(/\<\#(\w+)/) || [message.channel_id]).pop()
  controller.storage.channels.get(channel_id, function(getErr, channel) {
    if (getErr || !channel) {
      channel = {'id': channel_id,
                 'team_id': message.team_id
                }
    }
    if (value === null) {
      delete channel[property]
    } else {
      channel[property] = value
    }
    controller.storage.channels.save(channel, function(storeErr, d){
      cb(storeErr, channel)
    })
  })
}

function getChannelsWithFlags(controller, bot, message, cb) {
  var sendbackTeamChannels = function(err, channels) {
    // This allows us to set the default count for a given flag to 0
    var channelDict = {}

    if (!err && channels) {
      channels.map(function(c) {
        // This conditional may seem redundant for .find() cases
        // but see AUDIT note below
        if (c.team_id == message.team_id && c.label) {
          channelDict[c.id] = c;
        }
      })
    }

    cb(err, channelDict);
  }
  var storageChannels = controller.storage.channels

  if (storageChannels.find) {
    // not all storage backends have find()
    // e.g. Mongodb has it, but redis does not
    storageChannels.find({team_id: message.team_id}, sendbackTeamChannels)
  } else {
    // AUDIT NOTE: This channels.all gets all channels across
    // all instances -- not just the team instance
    // however you'll see we filter on message.team_id matching above
    // so nothing leaks (efficiency may be another question).
    storageChannels.all(sendbackTeamChannels)
  }
}

function getFlags(controller, bot, message, cb) {
  var sendbackTeamChannels = function(err, channels) {
    // This allows us to set the default count for a given flag to 0
    var flagDict =  new Proxy({}, {
                      get: function(object, property) {
                        return object.hasOwnProperty(property) ? object[property] : 0;
                      }
                    });
    if (!err && channels) {
      channels.map(function(c) {
        // This conditional may seem redundant for .find() cases
        // but see AUDIT note below
        if (c.team_id == message.team_id && c.label) {
          flagDict[c.label] += 1;
        }
      })
    }
    
    var finalMessage = flagFormatting(flagDict);

    cb(err, finalMessage);
  }
  var storageChannels = controller.storage.channels

  if (storageChannels.find) {
    // not all storage backends have find()
    // e.g. Mongodb has it, but redis does not
    storageChannels.find({team_id: message.team_id}, sendbackTeamChannels)
  } else {
    // AUDIT NOTE: This channels.all gets all channels across
    // all instances -- not just the team instance
    // however you'll see we filter on message.team_id matching above
    // so nothing leaks (efficiency may be another question).
    storageChannels.all(sendbackTeamChannels)
  }
}

function flagFormatting(flagCounts) {
  var formattedList = '```' +"All Flags:\n";

  for (var flag in flagCounts) {
    formattedList += flag;
    formattedList += "\n";
  }

  formattedList += '```';
  return formattedList
}

function logOut(controller, bot, message){
	let user = message.user_id

	var userChannels = []
	bot.api.channels.list({token:bot.config.token}, function(err,response){
		response.channels.forEach((item) => {
			if(item.members.includes(user)){
				userChannels.push(item.id)
			}
		 })
		 userChannels.forEach((channel)=> {
			 bot.api.channels.leave({token:bot.config.bot.app_token, channel: channel, user: user}, function(err,response){
				 // console.log(err, response)
			 })
		 })
		 bot.replyPublic(message, 'You have logged out! Thank you so much for volunteering your time - you are so appreciated!')
	})
}


function flag(controller, bot, message) {
  let label = message.text.replace(/.*>/,'').trim()

  if (!label) {
    label = 'needs attention'
  }
  if (message.command == '/unflag') {
    label = null
  }
  setChannelProperty(
    controller, message,
    'label', label,
    function(err, chan) {
      bot.replyPublic(message, message.command.slice(1) + 'ged')
    })
}

function success(controller, bot, message){
	var label;
	if(!label){
		label = 'successful'
	}
	bot.replyPublic(message,'You have successfully closed this conversation.')

	setChannelProperty(controller, message, 'success', label, function(err, chan){

		bot.api.channels.archive({token:bot.config.bot.app_token, channel: chan.id}, function(err, response){
			// console.log(err, response)
		})
	})
}

module.exports= function(controller){

  controller.on('slash_command', function (bot, message) {
    // Validate Slack verify token
    if (message.token !== VERIFY_TOKEN) {
      return bot.res.send(401, 'Unauthorized')
    }
    switch (message.command) {
      case '/hello':
        bot.replyPublic(message, 'hello there')
        break
      case '/cases':
        // list all the cases
        open_cases(controller, bot, message, tableFormat);
        break;
      case '/cases_pretty':
        // list all the cases
        open_cases(controller, bot, message, attachmentFormat);
        break;
      case '/nextcase':
        // assign yourself the next case
        next_case(controller, bot, message);
        break;
      case '/assign':
        // assign a volunteer to a particular channel
        assign_case(controller, bot, message);
        break;
      case '/flag':
      case '/unflag':
        // flag or unflag a particular channel (defaults to channel that you are in)
        flag(controller, bot, message)
        break
      case '/getflags':
        // list all the flags
        getFlags(controller, bot, message, function(err, flags) {
          bot.replyPrivate(message, flags)
        })
        break
      case '/success':
        // mark a channel as success (and closed)
        success(controller, bot, message)
        break
      case '/logout':
        // logs out and will make your cases available to other volunteers to pick up
        logOut(controller, bot, message)
        break
      default:
        bot.replyPublic(message, 'Sorry, I\'m not sure what that command is')
    }
  })

}; //module.export
