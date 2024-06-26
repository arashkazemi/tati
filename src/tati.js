/*
	Tati
	Copyright (C) 2022-2024 Arash Kazemi <contact.arash.kazemi@gmail.com>
	All rights reserved.

	Distributed under BSD-2-Clause License:

	Redistribution and use in source and binary forms, with or without
	modification, are permitted provided that the following conditions are met:

		* Redistributions of source code must retain the above copyright
			notice, this list of conditions and the following disclaimer.
		* Redistributions in binary form must reproduce the above copyright
			notice, this list of conditions and the following disclaimer in the
			documentation and/or other materials provided with the distribution.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
	AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
	IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
	ARE DISCLAIMED. IN NO EVENT SHALL ARASH KAZEMI BE LIABLE FOR ANY
	DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
	(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
	LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
	ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
	(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
	THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


const esprima = require("esprima");
const escodegen = require("escodegen");

class Tati
{

	last_column = -1;
	last_row = -1;

	error = null;

	#ui_refresh_steps = 50000;
	#ui_refresh_time = 0; // ms

	#timer_pause_time = undefined;
	#current_timer_idx = 0;
	#timer_queue = [];
	#timer_timeout = -1;

	#default_root = {};
	#use_async_prototypes;

	#run_func = null;
	#debug_func = null;

	#esp = null;
	#debug_resolve = null;
	#worker = null;

	#breakpoints = {};
	#context = {};
	#masked = ["globalThis", "self"]; // the class name will also be added in constructor

	#is_paused = false;
	#run_to_breakpoint = false;
	#step_loop_args = null;

	#get_worker_status_resolve = null;
	#get_worker_timers_resolve = null;
	#get_worker_context_resolve = null;
	#set_worker_context_resolve = null;
	__get_worker_context_on_next_step__ = true;

	#ui_refresh_counter = 0;
	#prepare_index = 0;
	#is_debug = false;

	#is_module = false;

	/**
	* Creates an instance of Tati.
	* There can be multiple instances and each can be controlled separately.
	*
	* @constructor
	*
	* @param {function} step_callback - The callback handler for stepping. It is
	*        called before the runner runs a breakpoint or steps to the next line.
	*        The row and column of the next step is given as the first and second
	*        arguments. If the watch flag is set, a third argument of watches values
	*        is also passed to the callback. The watched values is a dictionary,
	*        containing values of the local variables before running that step. If a
	*        variable is shadowed by another, the most recent value is shown.
	*
	* If the step callback returns true, the execution will be paused until one of
	* the functions `step()` or `continue()` is called. If it returns false the
	* execution continues to the step or breakpoint.
	*
	* @param {function} stop_callback - Is called when the running of the code is
	*        finished.
	*
	* @param {function} error_callback - Is called when there is an error in parse
	* 		 or run time. The first and second arguments are the line and column,
	*        third argument would be the type of error (parse or runtime), and the
	*        forth would be the error description.
	*
	* In case of parser errors, if `error_callback` argument is given to the
	* constructor, Tati will call it.
	*
	* In case of runtime errors, if `error_callback` argument is given to the
	* constructor, Tati will call it. But it will not cancel the event or stop
	* its propagation so it doesn't interfere with any other code handling mechanism.
	*
	* @param {boolean} use_worker - If set, the debugger will run in a web worker,
	* much safer but communication with it will be limited so the context should be
	* plain object and the script won't be able to interact with any other object
	* (like DOM) directly.
	*
	* @param {boolean} default_root - The `this` of the script being run. It is an empty
	* object {} by default. It is important because it masks the Tati object or the
	* worker that the script is being debugged in. If you want to set it to another
	* object this is the way, but note that if `use_worker` is set to true, it will not
	* work as expected because of the access limitations.
	*
	*/


	constructor(    step_callback=null,
					stop_callback=null,
					error_callback=null,

					config={ use_worker: false, 
							 default_root: undefined, 
							 use_async_prototypes: true }
				)
	{

		var perr = Tati.error_proxy.bind(this);

		this.#use_async_prototypes = !!config.use_async_prototypes;

		if(config.default_root!==undefined) this.#default_root = config.default_root;

		if(!!config.use_worker) {

			var build_worker = function(foo) {
				// Based on an answer on stackoverflow.com https://stackoverflow.com/a/16799132 by user @dan-man

				var str = foo.toString().match(/^\s*function\s*\(\s*\)\s*\{(([\s\S](?!\}$))*[\s\S])/)[1];

				if( typeof(Worker_threads)!=="undefined" ) {
					return new Worker_threads.Worker(window.URL.createObjectURL( new Blob([str],{type:'text/javascript'})) );
				}

				return new Worker(window.URL.createObjectURL( new Blob([str],{type:'text/javascript'})) );
			}

			this.#worker = build_worker( function() {

				self.__tati_space__ = {};
				self.__tati_space__.resolver = null;

				self.__tati_space__.step_callback = async function(r,c,vals) {
					if(self.__tati_space__.tati.__get_worker_context_on_next_step__) {
						self.postMessage(
											{
												ev:'step',r:r,c:c,vs:{...vals},
												ctx: self.__tati_space__.Tati.recursive_clone
																(self.__tati_space__.tati.get_worker_context())
											}
										);
					}
					else {
						self.postMessage( {ev:'step',r:r,c:c,vs:{...vals}} );
					}

					const msg_promise = new Promise((resolve) => self.__tati_space__.resolver = resolve);

					return await msg_promise;
				}

				self.__tati_space__.stop_callback = function() {
					if(self.__tati_space__.tati.__get_worker_context_on_next_step__) {
						self.postMessage(
											{
												ev:'stop',
												ctx: self.__tati_space__.Tati.recursive_clone
																(self.__tati_space__.tati.get_worker_context())
											}
										);
					}
					else {
						self.postMessage( {ev:'stop'} );
					}
				}

				self.__tati_space__.error_callback = function(r,c,t,d) {
					self.postMessage({ev:'err',r:r,c:c,t:t,d:d});
				}


				self.__tati_space__.tati = null;

				self.onmessage = async function(e) {

					if(self.__tati_space__.tati===null) {
						eval(e.data+";self.__tati_space__.Tati = Tati;");

						var Tati = self.__tati_space__.Tati;

						self.__tati_space__.tati = new Tati(self.__tati_space__.step_callback,
																								self.__tati_space__.stop_callback,
																								self.__tati_space__.error_callback);
						self.__tati_space__.onerror = self.__tati_space__.Tati.error_proxy.bind(self.__tati_space__.tati);
					}
					else {
						var Tati = self.__tati_space__.Tati;

						if(e.data.func==="set-funcs") {
							if(e.data.args===null) {
								self.__tati_space__.tati.set_worker_funcs(null,null);
							}
							else {
								self.__tati_space__.tati.set_worker_funcs(
													eval("("+e.data.args[0]+")"),
													eval("("+e.data.args[1]+")")
												);
							}
						}
						else if(e.data.func==="stepResponse") {
							self.__tati_space__.resolver(e.data.args[0]);
						}
						else if(e.data.func==="getWorkerContext") {
							self.postMessage( { ev:'context', 'ctx': await self.__tati_space__.tati.get_worker_context() } );
						}
						else if(e.data.func==="getTimers") {
							self.postMessage( { ev:'timers', 'timers': self.__tati_space__.Tati.recursive_clone(
																			await self.__tati_space__.tati.getTimers() 
																		) } );
						}
						else if(e.data.func==="getStatus") {
							self.postMessage( { ev:'status', 'status': await self.__tati_space__.tati.getStatus() } );
						}
						else {
							self.__tati_space__.tati[e.data.func](...e.data.args);
							self.postMessage( { ev:'context', 'ctx': await self.__tati_space__.tati.get_worker_context() } );
						}
					}
				};

			});

			this.#worker.onmessage = (e) => {
				if(e.data.ev==="step") {
					if(e.data.ctx!==undefined) {
						this.#context = e.data.ctx;
					}
					this.#worker.postMessage(
							{
								func:"stepResponse",
								args: [this.step_callback(e.data.r, e.data.c, e.data.vs)]
							}
						);
				}
				else if(e.data.ev==="getWorkerContext") {
					this.#get_worker_context_resolve(e.data.ctx);
				}
				else if(e.data.ev==="context") {
					this.#set_worker_context_resolve(e.data.status);
				}
				else if(e.data.ev==="timers") {
					this.#get_worker_timers_resolve(e.data.timers);
				}
				else if(e.data.ev==="status") {
					this.#get_worker_status_resolve(e.data.status);
				}
				else if(e.data.ev==="stop") {
					if(e.data.ctx!==undefined) {
						this.#context = e.data.ctx;
					}
					if(this.stop_callback!==null) {
						this.stop_callback();
					}
				}
				else if(e.data.ev==="err") {
					this.error_callback(e.data.r, e.data.c, e.data.t, e.data.d);
				}

			}

			this.#worker.onerror = perr;
			this.#worker.postMessage(Tati.toString());
		}


		if(this.#__is_browser__()) {
			window.addEventListener("unhandledrejection", perr);
		}
		else if(!Tati.is_worker()) {
			process.on('unhandledRejection', perr);
		}


		this.step_callback = step_callback;
		this.stop_callback = stop_callback;
		this.error_callback = error_callback;

		this.#masked.push(this.constructor.name);

	}


	/**
	* Parses the given code, and prepares it for the flow with control,
	* throws exception if there is a syntax problem in code.
	*
	* @param {string} code - The javascript code to compile/run.
	*
	* @param {boolean} watch_locals - If set, the callback will receive a
	* snapshot of the local variables in an object too.
	*
	* @param {boolean} step_loop_args - If set, it will also step into
	*        loop test and update expressions, like `i<n` and `i++` in the loop:
	*
	*            for( let i=0; i<n; i++ ) {...}
	*
	* @param {boolean} is_module - If set, the code will be treated as module,
	* i.e. import and export statements will work, otherwise they will raise
	* an unexpected token error in parse time. Note that imports cannot be
	* executed, because normal import statements must be the top-level of a module
	* and this cannot be the case when tati is wrapping the code. Also `import()`
	* function is supported by Tati, but unfortunately Esprima doesn't support
	* it yet and therefore raises a parser error exception.
	*
	*/

	prepare( code, watch_locals=true, step_loop_args=true, is_module=false )
	{

		if(is_module && this.#worker!==null && this.#__is_browser__()) {
			throw "modules can't be created dynamically in browser workers.";
		}

		this.#prepare_index++;
		this.error = null;
		this.#run_func = null;
		this.#debug_func = null;
		this.#is_paused = false;

		this.#step_loop_args = step_loop_args;
		this.#is_module = is_module;

		var ws = watch_locals ? [[]] : null;

		try {
			if(is_module) {
				this.#esp = esprima.parse( code, {loc:true, sourceType: 'module'} );
			}
			else {
				this.#esp = esprima.parse( code, {loc:true} );
			}
		}
		catch(e) {

			if(this.#worker!==null) {
				this.#worker.postMessage({"func":"set-funcs", "args":null});
			}

			if(this.error_callback!=null) {
				this.error_callback(e.lineNumber, e.column, "parse", e.description);
			}
			this.error = e;

			return;
		}


		let ctx = [ "__tati_template_watch_args__",
					"__tati_template_no_watch_args__",
					"__tati_error_proxy__",
					"setTimeout",
					"setInterval",
					"clearTimeout",
					"clearInterval",
					...Object.keys(this.#context),
					"__tati_space__",
					...this.#masked ].join(',');


		this.#run_func = eval(`(async function(${ctx}) { ${code} })`);

		this.#asyncize(this.#esp);
		this.#tatize(this.#esp, ws);

		const new_code = escodegen.generate(this.#esp).replace(/\/ __tati_template_paranthesis__/gm, "");

		console.log(new_code);

		this.#debug_func = eval(`(async function(${ctx}) { try{ ${new_code} } catch(e){__tati_error_proxy__(e)} })`);

		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"set-funcs", "args":[this.#run_func.toString(), this.#debug_func.toString()]});
		}

		this.#run_func = this.#run_func.bind(this.#default_root);
		this.#debug_func = this.#debug_func.bind(this.#default_root);

	};


	/**
	* Runs the prepared code as it is, **without** the debug codes.
	* The only difference is that it is processed anyway, so the flow and
	* the environment of the two debug/run procedures are the same.
	*/

	run()
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"run", "args":[...arguments]});
			return;
		}

		if(this.#run_func==null) return;

		this.#is_debug = false;
		this.error = null;

		this.#reset_timers();

		let rf = this.#run_func.bind(null,
							this.#template_watch_args.bind(this,this.#prepare_index),
							this.#template_no_watch_args.bind(this,this.#prepare_index),
							Tati.error_proxy.bind(this),
							this.#set_timeout.bind(this),
							this.#set_interval.bind(this),
							this.#clear_timeout.bind(this),
							this.#clear_interval.bind(this),
							...Object.values(this.#context));


		if(this.is_module) {

			globalThis.__tati_run_func__ = rf;
			this.#eval_module("globalThis.__tati_run_promise__ = globalThis.__tati_run_func__()", function() {

				let pr = globalThis.__tati_run_promise__;
				globalThis.__tati_run_promise__ = undefined;
				globalThis.__tati_run_func__ = undefined;

				pr.then( (function() {

					if(this.#timer_queue.length===0) {
						if(this.stop_callback!==null) {
							this.stop_callback();
						}
					}

					this.#run_func = null;
					this.#debug_func = null;

				}).bind(this) );

				pr.catch( (function(e) {
					Tati.error_proxy.call(this,e);
				}).bind(this) );

			}.bind(this));

		}
		else {

			let pr = rf();

			pr.then( (function() {

				if(this.#timer_queue.length===0) {
					if(this.stop_callback!==null) {
						this.stop_callback();
					}
				}

				this.#run_func = null;
				this.#debug_func = null;

			}).bind(this) );

			pr.catch( (function(e) {
				Tati.error_proxy.call(this,e);
			}).bind(this) );

		}

	}


	/**
	* Runs the prepared code **with** the debug codes.
	* You can step line by line or run until reaching a breakpoint. It will
	* call the `step_callback` that was given to constructor.
	*
	* @param {boolean} run_to_breakpoint - If true it will continue running
	* until reaching a breakpoint. If false, it will step line by line.
	*/

	debug(run_to_breakpoint=false)
	{

		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"debug", "args":[...arguments]});
			return;
		}

		if(this.#debug_func==null) return;

		this.#is_debug = true;
		this.error = null;

		this.#run_to_breakpoint = run_to_breakpoint;

		this.#reset_timers();

		let rf = this.#debug_func.bind( null,
										this.#template_watch_args.bind(this,this.#prepare_index),
										this.#template_no_watch_args.bind(this,this.#prepare_index),
										Tati.error_proxy.bind(this),
										this.#set_timeout.bind(this),
										this.#set_interval.bind(this),
										this.#clear_timeout.bind(this),
										this.#clear_interval.bind(this),
										...Object.values(this.#context) );


		if(this.is_module) {

			globalThis.__tati_run_func__ = rf;
			this.#eval_module("globalThis.__tati_run_promise__ = globalThis.__tati_run_func__()", function() {
				let pr = globalThis.__tati_run_promise__;
				globalThis.__tati_run_promise__ = undefined;
				globalThis.__tati_run_func__ = undefined;

				pr.then( (function() {
					if(this.#timer_queue.length===0) {
						if(this.stop_callback!==null) {
							this.stop_callback();
						}
						this.#debug_func = null;
						this.#run_func = null;
					}

				}).bind(this) );

				pr.catch( (function(e) {
					Tati.error_proxy.call(this,e);
				}).bind(this) );

			}.bind(this));

		}
		else {

			let pr = rf();

			pr.then( (function() {
				if(this.#timer_queue.length===0) {
					if(this.stop_callback!==null) {
						this.stop_callback();
					}
				}
				this.#debug_func = null;
				this.#run_func = null;

			}).bind(this) );

			pr.catch( (function(e) {
				Tati.error_proxy.call(this,e);
			}).bind(this) );

		}

	}


	/**
	* Steps to the next line/expression.
	* It will call the `step_callback` that was given to constructor.
	*
	* @param {boolean} get_worker_context_on_callback When using workers,
	* Tati updates the context values before calling the `step_callback`,
	* unless the `get_worker_context_on_callback` parameter is set to `false`.
	* It may be needed when the context variables are big and transmitting them
	* between the user instance and the worker are intensive. In such cases,
	* if the user needs to check the new context values, they should call
	* {@link Tati#getWorkerContext} before getting the context.
	*/

	step(get_worker_context_on_callback=true)
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"step", "args":[...arguments]});
			return;
		}

		this.__get_worker_context_on_next_step__ = get_worker_context_on_callback;

		this.#run_to_breakpoint = false;

		//if(this.#debug_func!==null && this.#debug_resolve!=null) {
			this.#debug_resolve(true);
			this.#resume_timers();
		//}
	}


	/**
	* Runs to the next breakpoint or end.
	* It will call the `step_callback` that was given to constructor on
	* reaching a breakpoint.
	*
	* @param {boolean} get_worker_context_on_callback see {@link Tati#step}
	*/

	continue(get_worker_context_on_callback=true)
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"continue", "args":[...arguments]});
			return;
		}

		this.__get_worker_context_on_next_step__ = get_worker_context_on_callback;

		this.#run_to_breakpoint = true;

		this.#is_paused = false; 


		if(this.#debug_resolve!==null) {
			this.#debug_resolve(true);
		}
		this.#resume_timers();
	}


	/**
	* Pauses the script. When the script is running an intensive loop or process,
	* checking for pause command will be done in intervals, which can be configured
	* using {@link Tati#configureUIRefreshRate}.
	*
	* When an script with a timeout or interval is being debugged but no breakpoint
	* is set, pause will be applied on the next callback, Tati will prevent timer
	* callback execution, but it doesn't stop the runtime event loop, so they will
	* expire as defined.
	*
	* Also note that Tati can only pause inside the given script and cannot
	* enter the called functions that are defined elsewhere, i.e. native functions
	* or external libraries.
	*
	* @param {boolean} get_worker_context_on_callback see {@link Tati#step}
	*/

	pause(get_worker_context_on_callback=true)
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"pause", "args":[...arguments]});
			return;
		}

		this.__get_worker_context_on_next_step__ = get_worker_context_on_callback;
		this.#run_to_breakpoint = false;

		this.#pause_timers();
		this.#is_paused = true;
	}


	/**
	* Configures the UI refresh checking. This is to make sure UI is responsive
	* and specially the process is pausable, which cannot be ensured on every
	* cycle because of performance considerations. As a result, UI refresh config
	* is not for a precise flow control, for a precise control use the
	* `step_callback` return value. For more info see {@link Tati#constructor}.
	*
	* @param {integer} ui_refresh_steps How many steps to take before refreshing
	* the UI.
	*
	* @param {integer} ui_refresh_time The time it will wait before continuing
	* the process.
	*/

	configureUIRefreshRate(ui_refresh_steps, ui_refresh_time)
	{
		this.#ui_refresh_steps = ui_refresh_steps;
		this.#ui_refresh_time = ui_refresh_time; // ms
	}


	/**
	* Sets a breakpoint on the given line.
	*
	* @param {integer} line The breakpoint line.
	*/

	setBreakpoint(line)
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"setBreakpoint", "args":[...arguments]});
			return;
		}

		this.#breakpoints[''+line] = true;
	}

	/**
	* Sets all breakpoints. Breakpoints should be in the form of
	* { 5: true, 10: true } where the keys are the line numbers
	* and the breakpoint is only set if the value is exactly true.
	*/

	setAllBreakpoints(bps)
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"setAllBreakpoints", "args":[...arguments]});
			return;
		}

		this.#breakpoints = bps;
	}

	/**
	* Clears the breakpoint on the given line.
	*
	* @param {integer} line The breakpoint line.
	*/

	clearBreakpoint(line)
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"clearBreakpoint", "args":[...arguments]});
			return;
		}

		delete this.#breakpoints[''+line];
	}

	/**
	* Clears all the breakpoints.
	*/

	clearAllBreakpoints()
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"clearAllBreakpoints", "args":[...arguments]});
			return;
		}

		this.#breakpoints = {};
	}

	/**
	* Sets context variables. The members of the context will be set
	* as given in this object. The masked argument can be used to define
	* the variables and objects to be masked. Note that the masked are
	* given in a list of strings.
	*
	*     k.setContext({foo:123, bar:"hello"}, [document, window]);
	*
	* The masked list is not necessary, and if not set, the masked list
	* contains three predefined elements: `globalThis`, self and the class
	* name of Tati, which is normally Tati itself.
	*
	* This function should be called before calling `prepare` if the keys
	* of the context or the members of the masked list are changed. But it
	* won't be necessary if only the values of context variables are
	* changed later.
	*
	* Note that if `use_worker` is set to `true` in the constructor 
	* configuration, the worker context objects are clones and are not 
	* directly accessible. So directly modifying the value of context 
	* variables won't work and you should use `setContext` or 
	* `setContextVariable` methods. Also note that the context object must 
	* be a plain object when using workers. Tati will automatically convert 
	* context variables to plain objects when using workers, which means the 
	* functions will be converted to `undefined`.
	*
	* This function is asynchronous, so you may want to use await to make
	* sure the context is set accordingly.
	*
	* @param {object} context The new context object. If `use_worker` is
	* set, it will be cloned to a plain object.
	*
	* @param {Array} masked The list of the objects and variables to be
	* masked to `undefined`.
	*/

	async setContext(context, masked)
	{

		if(masked!==undefined) {
			this.#masked = [...masked];
		}

		if(context!==undefined) {
			this.#context = {...context};
		}

		if(this.#worker!==null) {
			try {
				this.#worker.postMessage({"func":"setContext", "args":Tati.recursive_clone([...arguments])});
				const msg_promise = new Promise((resolve) => this.#set_worker_context_resolve = resolve);
				await msg_promise;
			}
			catch(e) {
				throw "Error in cloning context object to pass to the worker. When using workers, context must be a plain object."
			}
		}

	}


	/**
	* Sets or defines context variables. Like `setContext`, the prepare
	* function should be called after adding new context properties.
	* And if `use_worker` is set `true`, the clones of the set values will
	* be used in the worker.
	*
	* This function is asynchronous, so you may want to use await to make
	* sure the context is set accordingly.
	*
	* @param {string} varname The variable name.
	*
	* @param {any} value The new value. If `use_worker` is set, it will
	* be cloned to a plain object.
	*/

	async setContextVariable(varname, value)
	{

		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"setContextVariable", "args":Tati.recursive_clone([...arguments])});
			const msg_promise = new Promise((resolve) => this.#set_worker_context_resolve = resolve);
			await msg_promise;
		}

		this.#context[varname] = value;
	}

	/**
	* Returns the value of a context variable. This can be used to access
	* the results of the script being debugged. Of course, the only types
	* that can be modified from inside the scripts are arrays and objects,
	* i.e. the variables that are passed by reference and not by value.
	* This will still be true when using workers, the only difference is
	* that a cloning will be applied and the results will only contain
	* plain objects. See also {@link Tati#getWorkerContext}
	*
	* @param {string} varname The variable name.
	*/

	getContextValue(varname)
	{
		return this.#context[varname];
	}

	/**
	* Returns the list of context variables.
	*/

	getContextList()
	{
		return Object.keys(this.#context);
	}


	/**
	* This is used to update the context copy outside the worker. Note
	* that this is not usually needed as Tati updates the context values
	* before calling the `step_callback`, unless the `get_worker_context_on_callback`
	* parameter is set to `false`. It may be needed when the context variables
	* are big and transmitting them between the user instance and the worker
	* are intensive. In such cases, if the user needs to check the new context
	* values, they should call this before getting the context.
	*
	* Note that this function is asynchronous, so you may need to use it
	* with an await directive.
	*/

	async getWorkerContext()
	{
		if(this.#worker!==null && !this.__get_worker_context_on_next_step__) {
			this.#worker.postMessage({"func":"getWorkerContext", "args":[...arguments]});

			const msg_promise = new Promise((resolve) => this.#get_worker_context_resolve = resolve);
			this.#context = await msg_promise;

			return this.#context;
		}
	}





	/**
	* Returns the list of working timers. 
	* 
	* Doesn't work when the code is running in worker mode. Use `getTimersAsync`
	* for such cases.
	*/

	getTimers()
	{
		const ret = [];
		const now = this.#is_paused?this.#timer_pause_time:Date.now();

		for(const t of this.#timer_queue) {
			ret.push( {type: t.repeat?"interval":"timeout", interval:t.interval, func: t.func, remaining: t.due - now } );
		}

		return ret;
	}


	/**
	* Returns the list of working timers like `getTimers` but also works when the code is running 
	* in worker mode. Use `await` directive when calling it.
	*/

	async getTimersAsync()
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"getTimers", "args":[...arguments]});

			const msg_promise = new Promise((resolve) => this.#get_worker_timers_resolve = resolve);

			return await msg_promise;
		}

		return getTimers();
	}


	/**
	* Returns the running status.
	* 
	* Doesn't work when the code is running in worker mode. Use `getStatusAsync`
	* for such cases.
	*/


	static STOPPED = 0;
	static RUNNING = 1;
	static PAUSED = -1;

	getStatus()
	{

		if(this.#is_paused)  {
			return Tati.PAUSED;
		}

		if(  this.#run_func!==null ||this.#debug_func!==null || this.#timer_queue.length!==0) {
			return Tati.RUNNING;
		}

		if( this.#run_func===null && this.#debug_func===null  ) {
			return Tati.STOPPED;
		}

		return Tati.RUNNING;
	}


	/**
	* Returns the running status like `getStatus` but also works when the code is running 
	* in worker mode. Use `await` directive when calling it.
	*/

	async getStatusAsync()
	{
		if(this.#worker!==null) {
			this.#worker.postMessage({"func":"getStatus", "args":[...arguments]});

			const msg_promise = new Promise((resolve) => this.#get_worker_status_resolve = resolve);

			return await msg_promise;
		}

		return getStatus();
	}



	// For internal use



	#eval_module_in_browser(code, onload)
	{
		// based on https://stackoverflow.com/a/47980361

		var script = document.createElement('script');
		script.type = 'module';
		script.innerHTML = code + "\n" + "if(window.script_loaded_hook){window.script_loaded_hook();}";

		window.script_loaded_hook = function(onload,script) {
			if(onload) onload();
				window.script_loaded_hook = undefined;
				document.body.removeChild(script);
		}.bind(null,onload,script);

		document.body.appendChild(script);
	}

	async #eval_module_in_node(code, onload)
	{
		const scr = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
		await import(scr);

		if(onload) onload();
	}

	#eval_module(code, onload)
	{
		if(this.#__is_browser__()) {
			this.#eval_module_in_browser(code, onload);
		}
		else {
			this.#eval_module_in_node(code, onload);
		}
	}



	set_worker_funcs(run_func, debug_func)
	{
		if(Tati.is_worker()) {
			if(run_func!==null) run_func = run_func.bind(this.#default_root);
			if(debug_func!==null) debug_func = debug_func.bind(this.#default_root);

			this.#run_func = run_func;
			this.#debug_func = debug_func;
		}
	}

	get_worker_context()
	{
		if(Tati.is_worker()) {
			return this.#context;
		}
	}


	#__is_browser__ = new Function("try {return this===window;}catch(e){ return false;}").bind(undefined);


	#wrap(a, ws)
	{
		this.#tatize( a, ws );

		if(a.type!="BlockStatement" && a.type!="CatchClause") {

			var el = {
				"type": "BlockStatement",
				"body": [

					this.#template_block(a, ws), a ]
			};

			return el;
		}

		return a;
	};


	#wrap_try_catch(a)
	{
			var el = {
					"type": "BlockStatement",
					"body": [
						{
							"type": "TryStatement",
							"block": a,
							"handler": {
								"type": "CatchClause",
								"param": {
									"type": "Identifier",
									"name": "e"
								},
								"body": {
									"type": "BlockStatement",
									"body": [
										{
											"type": "ExpressionStatement",
											"expression": {
												"type": "CallExpression",
												"callee": {
													"type": "Identifier",
													"name": "__tati_error_proxy__"
												},
												"arguments": [
													{
														"type": "Identifier",
														"name": "e"
													}
												]
											}
										}
									]
								}
							},
							"finalizer": null
						}
					]
				}

			return el;
	};


	#tatize(a,ws)
	{
		if( a==null ) return null;
		if( typeof(a.type)=="undefined" ) return;

		if(ws!=null && a.type=="BlockStatement") ws=[ws];

		if( a.type=="Program" ||
			a.type=="BlockStatement" )
		{
			for(var i=0; i<a.body.length; i++) {

				var abi = a.body[i];

				if( abi.type!="BlockStatement" &&
					abi.type!="FunctionDeclaration" &&
					abi.type!="DoWhileStatement" )
				{

					var el =  this.#template_block(abi, ws);
					if(typeof(el)==typeof(undefined)) continue;

					a.body.splice(i,0,el);
					i++;
				}

				this.#tatize( abi, ws );
			}

		}
		else if(a.type=="ForStatement") {
			if(this.#step_loop_args) {

				this.#tatize(a.init, ws);
				a.test = this.#template_inline(a.test, ws);
				a.update = this.#template_inline(a.update, ws);
			}

			a.body = this.#wrap(a.body, ws);
		}
		else if(a.type=="DoWhileStatement" ||
			a.type=="WhileStatement" )
		{
			if(this.#step_loop_args) {
				a.test = this.#template_inline(a.test, ws);
			}

			a.body = this.#wrap(a.body, ws);
		}
		else if(a.type=="FunctionDeclaration" ||
			a.type=="FunctionExpression" ||
			a.type=="ArrowFunctionExpression" ||
			a.type=="ForInStatement" ||
			a.type=="ForOfStatement" ||
			a.type=="CatchClause" ||
			a.type=="WithStatement")
		{
			if( a.type=="FunctionDeclaration" ||
				a.type=="FunctionExpression" ||
				a.type=="ArrowFunctionExpression") {

				for(var j=0; j<a.params.length; j++) {
					if(ws!=null)
						ws.push(a.params[j].name);
				}
			}
			if(a.type==="ArrowFunctionExpression") {
				if(a.body	.type==='BlockStatement') {
					a.body = this.#wrap_try_catch(this.#wrap(a.body, ws));
				}
				else {
					a.body = this.#template_inline(a.body, ws);
				}
			}
			else {
				a.body = this.#wrap_try_catch(this.#wrap(a.body, ws));
			}
		}
		else if(a.type=="IfStatement") {
			if(a.alternate!=null) a.alternate = this.#wrap(a.alternate, ws);
			if(a.consequent!=null) a.consequent = this.#wrap(a.consequent, ws);
		}
		else if(a.type=="TryStatement") {
			if(a.block!=null) a.block = this.#wrap(a.block, ws);
			if(a.handler!=null) a.handler = this.#wrap(a.handler, ws);
			if(a.finalizer!=null) a.finalizer = this.#wrap(a.finalizer, ws);
		}
		else if(a.type=="SwitchStatement") {

			for(var i=0; i<a.cases.length; i++) {

				var c = a.cases[i].consequent;

				for(var j=0; j<c.length; j++) {

					if( c[j].type!="BlockStatement" &&
						c[j].type!="FunctionDeclaration" &&
						c[j].type!="FunctionExpression" &&
						c[j].type!="DoWhileStatement" )
					{

						var el = this.#template_block(c[j], ws);

						c.splice(j,0,el);
						j++;
					}

					this.#tatize( c[j], ws );
				}
			}
		}
		else if(a.type=="VariableDeclaration") {
			for(var j=0; j<a.declarations.length; j++) {
				this.#tatize( a.declarations[j], ws );
			}
		}
		else {
			if(a.type=="VariableDeclarator") {
				if(ws!=null)
					ws.push(a.id.name);
			}

			for(let i in a) {
				if( Array.isArray(a[i]) ) {
					for(let j in a[i]) {
						this.#tatize( a[i][j], ws );
					}
				}
				else {
					this.#tatize( a[i], ws );
				}
			}
		}

		//if(ws!=null && a.type=="BlockStatement") ws=ws[0];
	}


	#asyncize(ast)
	{

		if(typeof(ast)=="object" ) {
			for(let el in ast) {
				this.#asyncize(ast[el]);
				if(ast[el]!=null && typeof(ast[el].type)!="undefined") {

					if(ast[el].type=="CallExpression") {

						ast[el] = {
							"type": "AwaitExpression",
							"argument": ast[el],
							"loc": ast[el].loc
						}
					}
					else if( ast[el].type=="FunctionDeclaration" ||
									 ast[el].type=="FunctionExpression" ||
									 ast[el].type=="ArrowFunctionExpression" ) {
						ast[el].async=true;
					}
				}
			}
		}
	}


	#set_timeout(func, interval)
	{
		return this.#add_timer( { func: func, interval: interval, due: Date.now()+interval, repeat: false } );
	}

	#set_interval(func, interval)
	{
		return this.#add_timer( { func: func, interval: interval, due: Date.now()+interval, repeat: true } );
	}

	#clear_timeout(idx)
	{
		//todo: this should be changed to a binary search

		for( const ti in this.#timer_queue ) {
			if(ti.repeat===false && ti.idx===idx) {
				this.#timer_queue.splice(ti, 1);

				if(ti===0) {
					clearTimeout( this.#timer_timeout );
					this.#timer_timeout = setTimeout( this.#run_timer.bind(this), this.#timer_queue[0].due - Date.now() );					
				}

				return;
			}
		}
	}

	#clear_interval(idx)
	{
		//todo: this should be changed to a binary search

		for( const ti in this.#timer_queue ) {
			if(ti.repeat===true && ti.idx===idx) {

				this.#timer_queue.splice(ti, 1);

				if(ti===0) {
					clearTimeout( this.#timer_timeout );
					this.#timer_timeout = setTimeout( this.#run_timer.bind(this), this.#timer_queue[0].due - Date.now() );					
				}
				return;
			}
		}
	}

	#add_timer(t)
	{
		t.idx = this.#current_timer_idx;

		//todo: this should be changed to a binary search

		let ti=0;
		while( ti < this.#timer_queue.length  &&  this.#timer_queue[ti].due <= t.due ) {
			ti++;
		}

		this.#timer_queue.splice(ti, 0, t);

		if(ti===0) {
			clearTimeout( this.#timer_timeout );
			this.#timer_timeout = setTimeout( this.#run_timer.bind(this), t.interval );
		}

		return this.#current_timer_idx++;
	}

	async #run_timer()
	{
		const t = this.#timer_queue.splice(0,1)[0];

		await t.func();

		if(t.repeat) {
			t.due = Date.now()+t.interval;
			this.#add_timer(t);
		}

		if(this.#timer_queue.length>0) {
			clearTimeout( this.#timer_timeout );
			this.#timer_timeout = setTimeout( this.#run_timer.bind(this), this.#timer_queue[0].due - Date.now());
		}
		else {
			if(this.#timer_queue.length===0) {

				if(this.#run_func===null && this.#debug_func===null) {
					if(this.stop_callback!==null) {
						this.stop_callback();
					}
				}
			}
		}
	}

	#reset_timers()
	{
		clearTimeout(this.#timer_timeout);
		this.#timer_pause_time = undefined;
		this.#current_timer_idx = 0;
		this.#timer_queue = [];
		this.#timer_timeout = -1;
	}

	#pause_timers()
	{
		clearTimeout( this.#timer_timeout );
		this.#timer_pause_time = Date.now();
	}

	#resume_timers()
	{


		if(!this.#timer_pause_time) return;

		if(this.#timer_queue.length>0) {
			this.#timer_pause_time -= Date.now();
			
			for( const t of this.#timer_queue ) {
				t.due -= this.#timer_pause_time;
			}

			this.#timer_timeout = setTimeout( this.#run_timer.bind(this), this.#timer_queue[0].due - Date.now());
		}

		this.#timer_pause_time = undefined;
	}


	#template_generate_watch_args(ws)
	{
		if(ws.length==0) return [];

		var wss=this.#template_generate_watch_args(ws[0]);

		for(let i=1; i<ws.length; i++) {
			wss.push({
				"type": "Literal",
				"value": ws[i],
				"raw": "\""+ws[i]+"\""
			});

			wss.push({
  "type": "CallExpression",
  "callee": {
    "type": "ArrowFunctionExpression",
    "id": null,
    "params": [],
    "body": {
      "type": "BlockStatement",
      "body": [
        {
          "type": "TryStatement",
          "block": {
            "type": "BlockStatement",
            "body": [
              {
                "type": "ReturnStatement",
                "argument": {
                  "type": "ConditionalExpression",
                  "test": {
                    "type": "BinaryExpression",
                    "operator": "===",
                    "left": {
                      "type": "UnaryExpression",
                      "operator": "typeof",
                      "argument": {
                        "type": "Identifier",
                        "name": ws[i]
                      },
                      "prefix": true
                    },
                    "right": {
                      "type": "Literal",
                      "value": "undefined",
                      "raw": "'undefined'"
                    }
                  },
                  "consequent": {
                    "type": "Identifier",
                    "name": "undefined"
                  },
                  "alternate": {
                    "type": "Identifier",
                    "name": ws[i]
                  }
                }
              }
            ]
          },
          "handler": {
            "type": "CatchClause",
            "param": {
              "type": "Identifier",
              "name": "e"
            },
            "body": {
              "type": "BlockStatement",
              "body": [
                {
                  "type": "ReturnStatement",
                  "argument": {
                    "type": "Identifier",
                    "name": "undefined"
                  }
                }
              ]
            }
          },
          "finalizer": null
        }
      ]
    },
    "generator": false,
    "expression": false,
    "async": false
  },
  "arguments": []
});
		}

		return wss;
	}


	#template_block(el,ws)
	{

		let res = {
			"type": "ExpressionStatement",
			"expression": {
				"type": "AwaitExpression",
				"argument": {
					"type": "CallExpression",
					"callee": {
						"type": "Identifier",
						"name": "__tati_template_no_watch_args__"
					},
					"arguments": [
					{
						"type": "Literal",
						"value": el.loc.start.line,
						"raw": "" + el.loc.start.line
					},
					{
						"type": "Literal",
						"value": el.loc.start.column,
						"raw": "" + el.loc.start.column
					}
					],
					"optional": false
				}
			}
		};

		if(ws!=null) {
			let wss = this.#template_generate_watch_args(ws);
			res.expression.argument.callee.name="__tati_template_watch_args__";
			res.expression.argument.arguments.push(...wss);
		}

		return res;
	};


	#template_block_sync(el,ws)
	{

		let res = {
					"type": "CallExpression",
					"callee": {
						"type": "Identifier",
						"name": "__tati_template_no_watch_args__"
					},
					"arguments": [
					{
						"type": "Literal",
						"value": el.loc.start.line,
						"raw": "" + el.loc.start.line
					},
					{
						"type": "Literal",
						"value": el.loc.start.column,
						"raw": "" + el.loc.start.column
					}
					],
					"optional": false
		};

		if(ws!=null) {
			let wss = this.#template_generate_watch_args(ws);
			console.log(ws);
			console.log(wss);
			res.expression.argument.callee.name="__tati_template_watch_args__";
			res.expression.argument.arguments.push(...wss);
		}

		return res;
	};


	#template_inline(el,ws)
	{


		let res =

				{
					"type": "BinaryExpression",
					"operator": "/",
					"left":
								{
									"type": "SequenceExpression",
									"expressions":[
										{
												"type": "AwaitExpression",
												"argument": {
													"type": "CallExpression",
													"callee": {
														"type": "Identifier",
														"name": "__tati_template_no_watch_args__"
													},
													"arguments": [
													{
														"type": "Literal",
														"value": el.loc.start.line,
														"raw": "" + el.loc.start.line
													},
													{
														"type": "Literal",
														"value": el.loc.start.column,
														"raw": "" + el.loc.start.column
													},
												],
												"optional": false
											}
									},
									el
								]},

								"right": {
												"type": "Identifier",
												"name": "__tati_template_paranthesis__"
											}
				};

		if(ws!=null) {
			let wss = this.#template_generate_watch_args(ws);
			console.log(ws);
			console.log(wss);
			res.left.expressions[0].argument.callee.name="__tati_template_watch_args__";
			res.left.expressions[0].argument.arguments.push(...wss);
		}
``
		return res;

	};


	async #template_watch_args(pid, r,c)
	{
		if(pid!==this.#prepare_index) return new Promise( function(res,rej) {} );

		const self = this;

		c++;

		this.last_column = c;
		this.last_row = r;

		if(this.#ui_refresh_counter>=this.#ui_refresh_steps) {
			this.#ui_refresh_counter=0;
			await new Promise(r => setTimeout(r, this.#ui_refresh_time));
		}
		else this.#ui_refresh_counter++;


		if( this.#run_to_breakpoint ) {

			if(this.#breakpoints[r]) {

				let vals={};

				for(let i=3;i<arguments.length;i+=2) {
					if(arguments[i+1]==undefined) {
						vals[arguments[i]]=undefined;
					}
					else {
						vals[arguments[i]]=arguments[i+1];
					}
				}

				if( this.step_callback(r,c,vals) ) {
					this.#pause_timers();
					self.#is_paused = true;
					return new Promise(
							function(res,rej) {
								self.#debug_resolve = res;
							}
						);
				}
			}

		}
		else {
			let vals={};

			for(let i=3;i<arguments.length;i+=2) {
				if(arguments[i+1]==undefined) {
					vals[arguments[i]]=undefined;
				}
				else {
					vals[arguments[i]]=arguments[i+1];
				}
			}

			if( this.step_callback(r,c,vals) ) {
				this.#pause_timers();
				self.#is_paused = true;
				return new Promise(
						function(res,rej) {
							self.#debug_resolve = res;
						}
					);
			}
		}
		return true;
	}


	async #template_no_watch_args(pid, r,c)
	{
		if(pid!==this.#prepare_index) return new Promise( function(res,rej) {} );

		const self = this;

		c++;

		this.last_column = c;
		this.last_row = r;


		if(this.#ui_refresh_counter>=this.#ui_refresh_steps) {
			this.#ui_refresh_counter=0;
			await new Promise(r => setTimeout(r, this.#ui_refresh_time));
		}
		else this.#ui_refresh_counter++;

		if( this.#run_to_breakpoint ) {

			if(this.#breakpoints[r]) {
				if( this.step_callback(r,c) ) {
					this.#pause_timers();
					self.#is_paused = true;
					return new Promise(
							function(res,rej) {
								self.#debug_resolve = res;
							}
						);
				}
			}

		}
		else {
			if( this.step_callback(r,c) ) {
				this.#pause_timers();
				self.#is_paused = true;
				return new Promise(
						function(res,rej) {
							self.#debug_resolve = res;
						}
					);
			}
		}
		return true;
	}


	static error_proxy(err)
	{
		if(this.error) { // prevent multiple calls on error propagation
			return;
		}

		this.#reset_timers();

		if(!this.#is_debug) {
			let match = /eval:(\d+):(\d+)[\n]run/m.exec(err.stack);

			if(match===null) {
				match = /<anonymous>:(\d+):(\d+)\)\s+at Tati\.run/m.exec(err.stack);
			}

			if(match) {
				this.last_row = parseInt(match[1]);
				this.last_col = parseInt(match[2]);
			}
		}

		if(this.error_callback!=null) {
			if(err.reason!==undefined) {
				this.error_callback(this.last_row, this.last_column, "runtime", err.reason.message);
			}
			else if(err.message!==undefined) {
				this.error_callback(this.last_row, this.last_column, "runtime", err.message);
			}
			else {
				this.error_callback(this.last_row, this.last_column, "runtime", ""+err);
			}
		}

		this.error = err;

		this.last_row=-1;
		this.last_column=-1;
	}


	static is_worker()
	{
		if( typeof(Worker_threads)!=="undefined" ) {
			return !Worker_threads.isMainThread;
		}
		return typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
	}


	static recursive_clone(o)
	{
		let oc;

		if(o instanceof Array) oc = [];
		else oc = {};

		for(let i in o) {
			let v=o[i];
			if(typeof v=='number' || typeof v=='string' || v===null || v===undefined) {
				oc[i]=v;
			}
			else if(typeof v=='function') {
				oc[i] = undefined;
			}
			else oc[i] = Tati.recursive_clone(v);
		}
		return oc;
	}



}

module.exports = Tati;
