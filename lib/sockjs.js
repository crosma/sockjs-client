var SockJS = function(url, protocols, options) {
    var that = this;
    that._options = {devel: false, debug: false};
    if (options) {
        utils.objectExtend(that._options, options);
    }
    that._base_url = utils.amendUrl(url);
    that._server = that._options.server || utils.random_number_string(1000);
    that._connid = utils.random_string(8);
    that._trans_url = that._base_url + '/' + that._server + '/' + that._connid;
    that._protocols = ['websocket',
                       'iframe-eventsource',
                       'xhr-polling',
                       'iframe-xhr-polling',
                       'jsonp-polling'];
    switch(typeof protocols) {
    case 'undefined': break;
    case 'string': that._protocols = [protocols]; break;
    default: that._protocols = protocols; break;
    }
    that.protocol = null;
    that.readyState = SockJS.CONNECTING;
    that._didClose();
};
// Inheritance
SockJS.prototype = new REventTarget();

SockJS.version = "<!-- version -->";

SockJS.CONNECTING = 0;
SockJS.OPEN = 1;
SockJS.CLOSING = 2;
SockJS.CLOSED = 3;

SockJS.prototype._debug = function() {
    if (this._options.debug)
        utils.log.apply(utils, arguments);
};

SockJS.prototype._dispatchOpen = function() {
    var that = this;
    if (that.readyState === SockJS.CONNECTING) {
        if (that._transport_tref) {
            clearTimeout(that._transport_tref);
            that._transport_tref = null;
        }
        that.readyState = SockJS.OPEN;
        that.dispatchEvent(new SimpleEvent("open"));
    } else {
        // The server might have been restarted, and lost track of our
        // connection.
        that._didClose(1006, "Server lost session");
    }
};

SockJS.prototype._dispatchMessage = function(data) {
    var that = this;
    if (that.readyState !== SockJS.OPEN)
            return;
    that.dispatchEvent(new SimpleEvent("message", {data: data}));
};


SockJS.prototype._didClose = function(status, reason) {
    var that = this;
    if (that.readyState !== SockJS.CONNECTING &&
        that.readyState !== SockJS.OPEN &&
        that.readyState !== SockJS.CLOSING)
            throw new Error('INVALID_STATE_ERR');
    if (that._transport)
        that._transport.doCleanup();
    that._transport = null;
    if (that._transport_tref) {
        clearTimeout(that._transport_tref);
        that._transport_tref = null;
    }
    var close_event = new SimpleEvent("close", {status: status, reason: reason});

    if (!utils.userSetStatus(status) && that.readyState === SockJS.CONNECTING) {
        if (that._try_next_protocol(close_event)) {
            that._transport_tref = setTimeout(
                function() {
                    if (that.readyState === SockJS.CONNECTING) {
                        // I can't understand how it is possible to run
                        // this timer, when the state is CLOSED, but
                        // apparently in IE everythin is possible.
                        that._didClose(2007,
                                       "Transport timeouted");
                    }
                }, 5001);
            return;
        }
        close_event = new SimpleEvent("close", {status: 2000,
                                                reason: "All transports failed",
                                                last_event: close_event});
    }
    that.readyState = SockJS.CLOSED;

    setTimeout(function() {
                   that.dispatchEvent(close_event);
               }, 0);
};

SockJS.prototype._didMessage = function(data) {
    var that = this;
    var type = data.slice(0, 1);
    switch(type) {
    case 'o':
        that._dispatchOpen();
        break;
    case 'a':
        var payload = JSON.parse(data.slice(1) || '[]');
        for(var i=0; i < payload.length; i++){
            that._dispatchMessage(payload[i]);
        }
        break;
    case 'm':
        var payload = JSON.parse(data.slice(1) || 'null');
        that._dispatchMessage(payload);
        break;
    case 'c':
        var payload = JSON.parse(data.slice(1) || '[]');
        that._didClose(payload[0], payload[1]);
        break;
    case 'h':// heartbeat, ignore
        break;
    }
};

SockJS.prototype._try_next_protocol = function(close_event) {
    var that = this;
    if (that.protocol)
        that._debug('Closed transport:', that.protocol, ''+close_event);

    while(1) {
        that.protocol = that._protocols.shift();
        if (!that.protocol) {
            return false;
        }
        if (!SockJS[that.protocol] || !SockJS[that.protocol].enabled()) {
            that._debug('Skipping transport:', that.protocol);
        } else {
            that._debug('Opening transport:', that.protocol);
            that._transport = new SockJS[that.protocol](that, that._trans_url,
                                                        that._base_url);
            return true;
        }
    }
};

SockJS.prototype.close = function(status, reason) {
    var that = this;
    if (status && !utils.userSetStatus(status))
        throw new Error("INVALID_ACCESS_ERR");
    if(that.readyState !== SockJS.CONNECTING &&
       that.readyState !== SockJS.OPEN) {
        return false;
    }
    that.readyState = SockJS.CLOSING;
    that._didClose(status || 1000, reason || "Normal closure");
    return true;
};

SockJS.prototype.send = function(data) {
    var that = this;
    if (that.readyState === SockJS.CONNECTING)
        throw new Error('INVALID_STATE_ERR');
    if (that.readyState === SockJS.OPEN) {
        that._transport.doSend(JSON.stringify(data));
    }
    return true;
};