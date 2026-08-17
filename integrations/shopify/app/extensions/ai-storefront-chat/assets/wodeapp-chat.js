(function () {
  var root = document.getElementById('wodeapp-ai-chat-root');
  if (!root) return;

  var shop = root.getAttribute('data-shop') || '';
  var token = root.getAttribute('data-token') || '';
  var apiBase = (root.getAttribute('data-api-base') || '').replace(/\/$/, '');
  if (!shop || !token || !apiBase) return;

  var state = {
    open: false,
    loading: false,
    title: 'Store Assistant',
    welcome: 'Hi! How can I help?',
    history: [],
  };

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'wode-chat-launcher';
  launcher.textContent = 'Chat';

  var panel = document.createElement('div');
  panel.className = 'wode-chat-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="wode-chat-header"><strong></strong><button type="button" aria-label="Close">×</button></div>' +
    '<div class="wode-chat-messages"></div>' +
    '<p class="wode-chat-hint"></p>' +
    '<form class="wode-chat-form"><input type="text" maxlength="2000" placeholder="Ask about products, shipping, returns" autocomplete="off" /><button type="submit">Send</button></form>';

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var titleEl = panel.querySelector('.wode-chat-header strong');
  var closeEl = panel.querySelector('.wode-chat-header button');
  var messagesEl = panel.querySelector('.wode-chat-messages');
  var hintEl = panel.querySelector('.wode-chat-hint');
  var formEl = panel.querySelector('.wode-chat-form');
  var inputEl = formEl.querySelector('input');
  var sendEl = formEl.querySelector('button');

  function addBubble(role, text) {
    var bubble = document.createElement('div');
    bubble.className = 'wode-chat-bubble ' + (role === 'user' ? 'user' : 'bot');
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setOpen(next) {
    state.open = next;
    panel.hidden = !next;
    launcher.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) inputEl.focus();
  }

  function setLoading(next) {
    state.loading = next;
    sendEl.disabled = next;
    inputEl.disabled = next;
  }

  async function loadConfig() {
    var response = await fetch(
      apiBase + '/widget-config?shop=' + encodeURIComponent(shop) + '&token=' + encodeURIComponent(token)
    );
    var data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok || !data.success) {
      throw new Error((data && data.error) || 'Chat is unavailable');
    }
    state.title = (data.config && data.config.title) || state.title;
    state.welcome = (data.config && data.config.welcomeMessage) || state.welcome;
    titleEl.textContent = state.title;
    launcher.textContent = state.title;
    hintEl.textContent = data.config && data.config.handoffEmail
      ? 'Human help: ' + data.config.handoffEmail
      : 'Answers are based on this store’s knowledge base.';
    addBubble('bot', state.welcome);
  }

  async function sendMessage(message) {
    setLoading(true);
    addBubble('user', message);
    try {
      var response = await fetch(apiBase + '/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wode-Chat-Token': token,
        },
        body: JSON.stringify({
          shop: shop,
          token: token,
          message: message,
          history: state.history,
        }),
      });
      var data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !data.success) {
        throw new Error((data && data.error) || 'Unable to reply right now');
      }
      addBubble('bot', data.reply || '');
      state.history.push({ role: 'user', content: message });
      state.history.push({ role: 'assistant', content: data.reply || '' });
      if (state.history.length > 8) state.history = state.history.slice(-8);
    } catch (error) {
      addBubble('bot', error instanceof Error ? error.message : 'Unable to reply right now');
    } finally {
      setLoading(false);
    }
  }

  launcher.addEventListener('click', function () {
    setOpen(!state.open);
  });
  closeEl.addEventListener('click', function () {
    setOpen(false);
  });
  formEl.addEventListener('submit', function (event) {
    event.preventDefault();
    var message = (inputEl.value || '').trim();
    if (!message || state.loading) return;
    inputEl.value = '';
    sendMessage(message);
  });

  loadConfig().catch(function (error) {
    titleEl.textContent = 'Chat unavailable';
    launcher.textContent = 'Chat';
    hintEl.textContent = error instanceof Error ? error.message : 'Chat unavailable';
  });
})();
