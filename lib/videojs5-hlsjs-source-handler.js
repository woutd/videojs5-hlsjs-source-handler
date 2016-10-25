require("videojs-quality-picker");

var attachVideojsStreamrootProvider = function (window, videojs, Hls) {
    function StreamrootProviderHLS (source, tech) {
        tech.name_ = 'streamrootHLS';

        var _video = tech.el();
        var _hls;
        var _errorCounts = {};
        var _duration = null;

        _video.addEventListener('error', function(evt) {
            var errorTxt,mediaError=evt.currentTarget.error;

            if (mediaError !== null) {
                switch(mediaError.code) {
                    case mediaError.MEDIA_ERR_ABORTED:
                        errorTxt = "You aborted the video playback";
                        break;
                    case mediaError.MEDIA_ERR_DECODE:
                        errorTxt = "The video playback was aborted due to a corruption problem or because the video used features your browser did not support";
                        _handleMediaError();
                        break;
                    case mediaError.MEDIA_ERR_NETWORK:
                        errorTxt = "A network error caused the video download to fail part-way";
                        break;
                    case mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorTxt = "The video could not be loaded, either because the server or network failed or because the format is not supported";
                        break;
                }

                console.error("MEDIA_ERROR: ", errorTxt);
            }
        });

        function initialize() {
            var hlsjsConfig = tech.options_.hlsjsConfig || {};

            _hls = new Hls(hlsjsConfig);
            _hls.on(Hls.Events.ERROR, function(event, data) { _onError(event, data, tech, _errorCounts) });
            _hls.on(Hls.Events.MANIFEST_PARSED, _onMetaData);
            _hls.on(Hls.Events.LEVEL_LOADED, function(event, data) { _duration = data.details.live ? Infinity : data.details.totalduration; });

            _hls.attachMedia(_video);
        }

        this.duration = function () {
            return _duration || _video.duration || 0;
        };

        this.dispose = function () {
            _hls.destroy();
        };

        function load(source) {
            _hls.loadSource(source.src);

            if (!_hls.config.autoStartLoad) {
                _startLoadOnPlay();
            }
        }

        function switchQuality(qualityId, trackType) {
            _hls.nextLevel = qualityId;
        }

        // call _hls.startLoad on video play request
        function _startLoadOnPlay() {
            var checkStartLoad = function(e) {
                e.target.removeEventListener(e.type, checkStartLoad);
                // if the manifest parsed, call _hls.startLoad immediately, otherwise wait until the manifest is parsed
                if (typeof _hls.streamController.levels !== 'undefined') {
                    _hls.startLoad(_hls.config.startPosition);
                } else {
                    var startLoad = function() {
                        _hls.off(Hls.Events.MANIFEST_PARSED, startLoad);
                        _hls.startLoad(_hls.config.startPosition);
                    };
                    _hls.on(Hls.Events.MANIFEST_PARSED, startLoad);
                }
            };
            _video.addEventListener('play', checkStartLoad);
        }

        function _handleMediaError() {
            if (_errorCounts[Hls.ErrorTypes.MEDIA_ERROR] === 1) {
                console.info("trying to recover media error");
                _hls.recoverMediaError();
            } else if (_errorCounts[Hls.ErrorTypes.MEDIA_ERROR] === 2) {
                console.info("2nd try to recover media error (by swapping audio codec");
                _hls.swapAudioCodec();
                _hls.recoverMediaError();
            } else if (_errorCounts[Hls.ErrorTypes.MEDIA_ERROR] > 2) {
                console.info("bubbling media error up to VIDEOJS");
                error.code = 3;
                tech.error = function() { return error; };
                tech.trigger('error');
            }
        }

        function _onError(event, data) {
            var error = {
                message: ('HLS.js error: ' + data.type + ' - fatal: ' + data.fatal + ' - ' + data.details),
            };
            console.error(error.message);

            // increment/set error count
            _errorCounts[data.type] ? _errorCounts[data.type] += 1 : _errorCounts[data.type] = 1;

            // implement simple error handling based on hls.js documentation (https://github.com/dailymotion/hls.js/blob/master/API.md#fifth-step-error-handling)
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.info("bubbling network error up to VIDEOJS");
                        error.code = 2;
                        tech.error = function() { return error; };
                        tech.trigger('error');
                        break;

                    case Hls.ErrorTypes.MEDIA_ERROR:
                        _handleMediaError();
                        break;

                    default:
                        // cannot recover
                        _hls.destroy();
                        console.info("bubbling error up to VIDEOJS");
                        tech.error = function() { return error; };
                        tech.trigger('error');
                        break;
                }
            }
        }

        function _onMetaData(event, data) {
            var cleanTracklist = [];

            if (data.levels.length > 1) {
                var autoLevel = {
                    id: -1,
                    label: "auto",
                    selected: -1 === _hls.manualLevel
                };
                cleanTracklist.push(autoLevel);
            }

            data.levels.forEach(function(level, index) {
                var quality = {}; // Don't write in level (shared reference with Hls.js)
                quality.id = index;
                quality.selected = index === _hls.manualLevel;
                quality.label = _levelLabel(level);

                cleanTracklist.push(quality);
            });

            var payload = {
                qualityData: {video: cleanTracklist},
                qualitySwitchCallback: switchQuality
            };

            tech.trigger('loadedqualitydata', payload);

            function _levelLabel(level) {
                if (level.height) return level.height + "p";
                else if (level.width) return Math.round(level.width * 9 / 16) + "p";
                else if (level.bitrate) return (level.bitrate / 1000) + "kbps";
                else return 0;
            }
        }

        initialize();
        load(source);
    }

    if (Hls.isSupported()) {
        videojs.getComponent('Html5').registerSourceHandler({

            canHandleSource: function (source) {

                var hlsTypeRE = /^application\/x-mpegURL$/i;
                var hlsExtRE = /\.m3u8/i;
                var result;

                if (hlsTypeRE.test(source.type)) {
                    result = 'probably';
                } else if (hlsExtRE.test(source.src)) {
                    result = 'maybe';
                } else {
                    result = '';
                }

                return result;
            },

            handleSource: function (source, tech) {

                if (tech.hlsProvider) {
                    tech.hlsProvider.dispose();
                }

                tech.hlsProvider = new StreamrootProviderHLS(source, tech);

                return tech.hlsProvider;
            }

        }, 0);

    } else {
        console.error("Hls.js is not supported in this browser!");
    }

    videojs.StreamrootProviderHLS = StreamrootProviderHLS;
};

module.exports = attachVideojsStreamrootProvider;
