const handleSlash = require('../commands/slash_handler');

module.exports= function(controller){

  controller.on('slash_command', function(bot, message) {
    handleSlash.mainHandler(controller, bot, message)
  })

}; //module.export
