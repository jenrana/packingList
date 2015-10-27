$(function() {

  Parse.$ = jQuery;

  // Initialize Parse with your Parse application javascript keys
    Parse.initialize("iEHnCz6tBbfat40smeJcdlYuPCcPfI0XOk56W36o", "X6XDmXP6ETqpgK1n3yAD9kyDtSmk0xGrFeIITQvC");

////////////////////////// TRIPS //////////////////////////////////////////////////    
   
  // Trip Model
  // ----------

  // Our basic Trip model has `tripName`, `order`, and `done` attributes.
  var Trip = Parse.Object.extend("Trips", {
    // Default attributes for the trip.
    defaults: {
      content: "empty trip...",
      done: false
    },

    // Ensure that each trip created has `content`.
    initialize: function() {
      if (!this.get("content")) {
        this.set({"content": this.defaults.content});
      }
    },

    // Toggle the `done` state of this trip item.
    toggle: function() {
      this.save({done: !this.get("done")});
    }
  });

  // This is the transient application state, not persisted on Parse
  var AppState = Parse.Object.extend("AppState", {
    defaults: {
      filter: "all"
    }
  });

  // Trip Collection
  // ---------------

  var TripList = Parse.Collection.extend({

    // Reference to this collection's model.
    model: Trip,

    // Filter down the list of all trips items that are finished.
    done: function() {
      return this.filter(function(trip){ return trip.get('done'); });
    },

    // Filter down the list to only trips items that are still not finished.
    remaining: function() {
      return this.without.apply(this, this.done());
    },

    // We keep the Trips in sequential order, despite being saved by unordered
    // GUID in the database. This generates the next order number for new items.
    nextOrder: function() {
      if (!this.length) return 1;
      return this.last().get('order') + 1;
    },

    // Trips are sorted by their original insertion order.
    comparator: function(trip) {
      return trip.get('order');
    }

  });

  // Trip Item View
  // --------------

  // The DOM element for a trip item...
  var TripView = Parse.View.extend({

    //... is a list tag.
    tagName:  "li",

    // Cache the template function for a single item.
    template: _.template($('#trip-template').html()),

    // The DOM events specific to an item.
    events: {
      "click .toggle"              : "toggleDone",
      "dblclick label.trip-content" : "edit",
      "click .trip-destroy"   : "clear",
      "keypress .edit"      : "updateOnEnter",
      "blur .edit"          : "close"
    },

    // The TripView listens for changes to its model, re-rendering. Since there's
    // a one-to-one correspondence between a Trip and a TripView in this
    // app, we set a direct reference on the model for convenience.
    initialize: function() {
      _.bindAll(this, 'render', 'close', 'remove');
      this.model.bind('change', this.render);
      this.model.bind('destroy', this.remove);
    },

    // Re-render the contents of the trip item.
    render: function() {
      $(this.el).html(this.template(this.model.toJSON()));
      this.input = this.$('.edit');
      return this;
    },

    // Toggle the `"done"` state of the model.
    toggleDone: function() {
      this.model.toggle();
    },

    // Switch this view into `"editing"` mode, displaying the input field.
    edit: function() {
      $(this.el).addClass("editing");
      this.input.focus();
    },

    // Close the `"editing"` mode, saving changes to the item.
    close: function() {
      this.model.save({content: this.input.val()});
      $(this.el).removeClass("editing");
    },

    // If you hit `enter`, we're through editing the item.
    updateOnEnter: function(e) {
      if (e.keyCode == 13) this.close();
    },

    // Remove the item, destroy the model.
    clear: function() {
      this.model.destroy();
    }

  });



  // The main view that lets a user manage their items
  var ManageTripView = Parse.View.extend({

    // Our template for the line of statistics at the bottom of the app.
    statsTemplate: _.template($('#stats-template').html()),

    // Delegated events for creating new items, and clearing completed ones.
    events: {
      "keypress #new-trip":  "createOnEnter",
      "click #clear-completed": "clearCompleted",
      "click #toggle-all": "toggleAllComplete",
      "click .log-out": "logOut",
      "click ul#filters a": "selectFilter"
    },

    el: ".content",

    // At initialization we bind to the relevant events on the `Trips`
    // collection, when items are added or changed. Kick things off by
    // loading any preexisting trips that might be saved to Parse.
    initialize: function() {
      var self = this;

      _.bindAll(this, 'addOne', 'addAll', 'addSome', 'render', 'toggleAllComplete', 'logOut', 'createOnEnter');

      // Main trip management template
      this.$el.html(_.template($("#manage-trips-template").html()));
      
      this.input = this.$("#new-trip");
      this.allCheckbox = this.$("#toggle-all")[0];

      // Create our collection of Trips
      this.trips = new TripList;

      // Setup the query for the collection to look for trips from the current user
      this.trips.query = new Parse.Query(Trip);
      this.trips.query.equalTo("user", Parse.User.current());
        
      this.trips.bind('add',     this.addOne);
      this.trips.bind('reset',   this.addAll);
      this.trips.bind('all',     this.render);

      // Fetch all the trips for this user
      this.trips.fetch();

      state.on("change", this.filter, this);
    },

    // Logs out the user and shows the login view
    logOut: function(e) {
      Parse.User.logOut();
      new LogInView();
      this.undelegateEvents();
      delete this;
    },

    // Re-rendering the App just means refreshing the statistics -- the rest
    // of the app doesn't change.
    render: function() {
      var done = this.trips.done().length;
      var remaining = this.trips.remaining().length;

      this.$('#trip-stats').html(this.statsTemplate({
        total:      this.trips.length,
        done:       done,
        remaining:  remaining
      }));

      this.delegateEvents();

      this.allCheckbox.checked = !remaining;
    },

    // Filters the list based on which type of filter is selected
    selectFilter: function(e) {
      var el = $(e.target);
      var filterValue = el.attr("id");
      state.set({filter: filterValue});
      Parse.history.navigate(filterValue);
    },

    filter: function() {
      var filterValue = state.get("filter");
      this.$("ul#filters a").removeClass("selected");
      this.$("ul#filters a#" + filterValue).addClass("selected");
      if (filterValue === "all") {
        this.addAll();
      } else if (filterValue === "completed") {
        this.addSome(function(item) { return item.get('done') });
      } else {
        this.addSome(function(item) { return !item.get('done') });
      }
    },

    // Resets the filters to display all items
    resetFilters: function() {
      this.$("ul#filters a").removeClass("selected");
      this.$("ul#filters a#all").addClass("selected");
      this.addAll();
    },

    // Add a single trip item to the list by creating a view for it, and
    // appending its element to the `<ul>`.
    addOne: function(trip) {
      var view = new TripView({model: trip});
      this.$("#trip-list").append(view.render().el);
    },

    // Add all items in the trips collection at once.
    addAll: function(collection, filter) {
      this.$("#trip-list").html("");
      this.trips.each(this.addOne);
    },

    // Only adds some trips, based on a filtering function that is passed in
    addSome: function(filter) {
      var self = this;
      this.$("#trip-list").html("");
      this.trips.chain().filter(filter).each(function(item) { self.addOne(item) });
    },

    // If you hit return in the main input field, create new Trip model
    createOnEnter: function(e) {
      var self = this;
      if (e.keyCode != 13) return;

      this.trips.create({
        tripName: this.input.val(),
        order:   this.trips.nextOrder(),
        done:    false,
        user:    Parse.User.current(),
        ACL:     new Parse.ACL(Parse.User.current())
      });

      this.input.val('');
      this.resetFilters();
    },

    // Clear all done trips, destroying their models.
    clearCompleted: function() {
      _.each(this.trips.done(), function(trip){ trip.destroy(); });
      return false;
    },

    toggleAllComplete: function () {
      var done = this.allCheckbox.checked;
      this.trips.each(function (trip) { trip.save({'done': done}); });
    }
  });

  var LogInView = Parse.View.extend({
    events: {
      "submit form.login-form": "logIn",
      "submit form.signup-form": "signUp"
    },

    el: ".content",
    
    initialize: function() {
      _.bindAll(this, "logIn", "signUp");
      this.render();
    },

    logIn: function(e) {
      var self = this;
      var username = this.$("#login-username").val();
      var password = this.$("#login-password").val();
      
      Parse.User.logIn(username, password, {
        success: function(user) {
          new ManageTripView();
          self.undelegateEvents();
          delete self;
        },

        error: function(user, error) {
          self.$(".login-form .error").html("Invalid username or password. Please try again.").show();
          self.$(".login-form button").removeAttr("disabled");
        }
      });

      this.$(".login-form button").attr("disabled", "disabled");

      return false;
    },

    signUp: function(e) {
      var self = this;
      var username = this.$("#signup-username").val();
      var password = this.$("#signup-password").val();
      
      Parse.User.signUp(username, password, { ACL: new Parse.ACL() }, {
        success: function(user) {
          new ManageTripView();
          self.undelegateEvents();
          delete self;
        },

        error: function(user, error) {
          self.$(".signup-form .error").html(_.escape(error.message)).show();
          self.$(".signup-form button").removeAttr("disabled");
        }
      });

      this.$(".signup-form button").attr("disabled", "disabled");

      return false;
    },

    render: function() {
      this.$el.html(_.template($("#login-template").html()));
      this.delegateEvents();
    }
  });

// The main view for the app
var AppView = Parse.View.extend({
    // Instead of generating a new element, bind to the existing skeleton of
    // the App already present in the HTML.
    el: $("#packingapp"),

    initialize: function() {
      this.render();
    },

    render: function() {
      if (Parse.User.current()) {
        new ManageTripView();
      } else {
        new LogInView();
      }
    }
  });

   
///////////////////////////////// Packing List Items /////////////////////////////////////////
    
     // Plist Model
  // ----------

  // Our basic Plist model has `content`, `order`, and `done` attributes.
  var Plist = Parse.Object.extend("PackingLists", {
    // Default attributes for the packing list item.
    defaults: {
      content: "empty item...",
      done: false
    },

    // Ensure that each packing list item created has `content`.
    initialize: function() {
      if (!this.get("content")) {
        this.set({"content": this.defaults.content});
      }
    },

    // Toggle the `done` state of this packing list item.
    toggle: function() {
      this.save({done: !this.get("done")});
    }
  });

  // This is the transient application state, not persisted on Parse
  var AppState = Parse.Object.extend("AppState", {
    defaults: {
      filter: "packall"
    }
  });

  // Packing List Collection
  // ---------------

  var PackingList = Parse.Collection.extend({

    // Reference to this collection's model.
    model: Plist,

    // Filter down the list of all packing list item that are packed.
    done: function() {
      return this.filter(function(plitem){ return plitem.get('done'); });
    },

    // Filter down the list to only packing list items that are still not packed.
    remaining: function() {
      return this.without.apply(this, this.done());
    },

    // We keep the packing list items in sequential order, despite being saved by unordered
    // GUID in the database. This generates the next order number for new items.
    nextOrder: function() {
      if (!this.length) return 1;
      return this.last().get('order') + 1;
    },

    // Todos are sorted by their original insertion order.
    comparator: function(plitem) {
      return plitem.get('order');
    }

  });

  // Packing list item View
  // --------------

  // The DOM element for an item...
  var PackingListView = Parse.View.extend({

    //... is a list tag.
    tagName:  "li",

    // Cache the template function for a single item.
    template: _.template($('#packing-item-template').html()),

    // The DOM events specific to an item.
    events: {
      "click .toggle"              : "toggleDone",
      "dblclick label.packing-list-content" : "edit",
      "click .packing-list-destroy"   : "clear",
      "keypress .edit"      : "updateOnEnter",
      "blur .edit"          : "close"
    },

    // The PackingListView listens for changes to its model, re-rendering. Since there's
    // a one-to-one correspondence between a Packing List Item and a PackingListView in this
    // app, we set a direct reference on the model for convenience.
    initialize: function() {
      _.bindAll(this, 'render', 'close', 'remove');
      this.model.bind('change', this.render);
      this.model.bind('destroy', this.remove);
    },

    // Re-render the contents of the item.
    render: function() {
      $(this.el).html(this.template(this.model.toJSON()));
      this.input = this.$('.edit');
      return this;
    },

    // Toggle the `"done"` state of the model.
    toggleDone: function() {
      this.model.toggle();
    },

    // Switch this view into `"editing"` mode, displaying the input field.
    edit: function() {
      $(this.el).addClass("editing");
      this.input.focus();
    },

    // Close the `"editing"` mode, saving changes to the packing list item.
    close: function() {
      this.model.save({content: this.input.val()});
      $(this.el).removeClass("editing");
    },

    // If you hit `enter`, we're through editing the item.
    updateOnEnter: function(e) {
      if (e.keyCode == 13) this.close();
    },

    // Remove the item, destroy the model.
    clear: function() {
      this.model.destroy();
    }

  });

  // The Application
  // ---------------

  // The main view that lets a user manage their items
  var ManagePlistView = Parse.View.extend({

    // Our template for the line of statistics at the bottom of the app.
    statsTemplate: _.template($('#packing-stats-template').html()),

    // Delegated events for creating new items, and clearing completed ones.
    events: {
      "keypress #new-list-item":  "createOnEnter",
      "click #clear-completed": "clearCompleted",
      "click #toggle-list-all": "toggleAllComplete",
      "click .log-out": "logOut",
      "click ul#filters a": "selectFilter"
    },


    el: ".content",

    // At initialization we bind to the relevant events on the `PackingList`
    // collection, when items are added or changed. Kick things off by
    // loading any preexisting items that might be saved to Parse.
    initialize: function(id) {
      var self = this;

      _.bindAll(this, 'addOne', 'addAll', 'addSome', 'render', 'toggleAllComplete', 'logOut', 'createOnEnter');
        
      // Main packing management template
      this.$el.html(_.template($("#packing-template").html()));
      
      this.input = this.$("#new-list-item");
      this.allCheckbox = this.$("#toggle-list-all")[0];
      
      // Create our collection of items
      this.plitems = new PackingList;

      // Setup the query for the collection to look for items from the current trip 
      this.plitems.query = new Parse.Query(Plist);
      this.plitems.query.equalTo("trip", {
        __type: "Pointer",
        className: "Trips",
        objectId: id
    });
        
      this.plitems.bind('add',     this.addOne);
      this.plitems.bind('reset',   this.addAll);
      this.plitems.bind('all',     this.render);
        
      // Fetch all the items for this trip
      this.plitems.fetch();
      state.on("change", this.filter, this);
    },
// Logs out the user and shows the login view
    logOut: function(e) {
      Parse.User.logOut();
      new LogInView();
      this.undelegateEvents();
      delete this;
    },
    // Re-rendering the App just means refreshing the statistics -- the rest
    // of the app doesn't change.
    render: function() {
      var done = this.plitems.done().length;
      var remaining = this.plitems.remaining().length;

      this.$('#packing-list-stats').html(this.statsTemplate({
        total:      this.plitems.length,
        done:       done,
        remaining:  remaining
      }));

      this.delegateEvents();

      this.allCheckbox.checked = !remaining;
    },

   
    // Filters the list based on which type of filter is selected
    selectFilter: function(e) {
      var el = $(e.target);
      var filterValue = el.attr("id");
      state.set({filter: filterValue});
      Parse.history.navigate(filterValue);
    },

    filter: function() {
      var filterValue = state.get("filter");
      this.$("ul#filters a").removeClass("selected");
      this.$("ul#filters a#" + filterValue).addClass("selected");
      if (filterValue === "packall") {
        this.addAll();
      } else if (filterValue === "packed") {
        this.addSome(function(item) { return item.get('done') });
      } else {
        this.addSome(function(item) { return !item.get('done') });
      }
    },

    // Resets the filters to display all items
    resetFilters: function() {
      this.$("ul#filters a").removeClass("selected");
      this.$("ul#filters a#packall").addClass("selected");
      this.addAll();
    },
      
    // Add a single packing item to the list by creating a view for it, and
    // appending its element to the `<ul>`.
    addOne: function(plitem) {
      var view = new PackingListView({model: plitem});
      this.$("#packing-list").append(view.render().el);
    },

    // Add all items in the Plist collection at once.
    addAll: function(collection, filter) {
      this.$("#packing-list").html("");
      this.plitems.each(this.addOne);
    },

    // Only adds some items, based on a filtering function that is passed in
    addSome: function(filter) {
      var self = this;
      this.$("#packing-list").html("");
      this.plitems.chain().filter(filter).each(function(item) { self.addOne(item) });
    },

    // If you hit return in the main input field, create new Plist model
    createOnEnter: function(e) {
      var self = this;
      if (e.keyCode != 13) return;
      this.plitems.create({
        content: this.input.val(),
        order:   this.plitems.nextOrder(),
        done:    false,
        ACL:     new Parse.ACL(Parse.User.current()),
        trip: {
        __type: "Pointer",
        className: "Trips",
        objectId: currentListID
        }
      });

      this.input.val('');
      this.resetFilters();
    },

    // Clear all packed items, destroying their models.
    clearCompleted: function() {
      _.each(this.plitems.done(), function(plitem){ plitem.destroy(); });
      return false;
    },

    toggleAllComplete: function () {
      var done = this.allCheckbox.checked;
      this.plitems.each(function (plitem) { plitem.save({'done': done}); });
    }
  });
  var currentListID;  
      
  var AppRouter = Parse.Router.extend({
    routes: {
      "all": "all",
      "active": "active",
      "completed": "completed",
     "lists/:id": "lists",
      "pack-all": "packall",
      "not-packed": "notpacked",
      "packed": "packed",
    },

    initialize: function(options) {
    },

    all: function() {
      state.set({ filter: "all" });
    },

    active: function() {
      state.set({ filter: "active" });
    },

    completed: function() {
      state.set({ filter: "completed" });
    },
    packall: function() {
      state.set({ filter: "packall" });
    },

    notpacked: function() {
      state.set({ filter: "notpacked" });
    },

    packed: function() {
      state.set({ filter: "packed" });
    },
    lists: function(id){
		currentListID = id;
        this.loadView(new ManagePlistView(id));
        console.log(id);
    },
	loadView : function(view) {
		this.view && (this.view.close ? this.view.close() : this.view.remove());
		this.view = view;
	}
  });

  var state = new AppState;

  new AppRouter;
  new AppView;
  Parse.history.start();
});

