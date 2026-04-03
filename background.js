// Обработчик сообщений от popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'closeTabsByDomain') {
    closeTabsByDomain(
      request.domain,
      request.match || 'all',
      request.closePinned || false,
      sendResponse
    );
    return true; // Для асинхронного ответа
  }
});

// Функция закрытия вкладок по домену
function closeTabsByDomain(domain, match, closePinned, sendResponse) {
  let normalizedDomain = domain.toLowerCase().trim();
  
  // Нормализация домена
  normalizedDomain = normalizedDomain
    .replace(/^(https?:\/\/)?/, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/\.$/, ''); // Убираем порт/точку в конце если есть

  match = match || 'all';
  closePinned = !!closePinned;
    
  chrome.tabs.query({}, function(tabs) {
    const tabsToClose = [];
    
    tabs.forEach(tab => {
      if (closePinned === false && tab.pinned) return;
      if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
        try {
          const url = new URL(tab.url);
          const hostname = url.hostname.toLowerCase();
          
          // Удаляем www. для сравнения
          const cleanHostname = hostname.replace(/^www\./, '').replace(/\.$/, '');
          
          const isExact = cleanHostname === normalizedDomain;
          const isSub = cleanHostname.endsWith('.' + normalizedDomain);

          let shouldClose = false;
          if (match === 'exact') {
            shouldClose = isExact;
          } else if (match === 'subdomains') {
            shouldClose = isSub;
          } else {
            // all
            shouldClose = isExact || isSub;
          }

          if (shouldClose) tabsToClose.push(tab.id);
        } catch (e) {
          console.log('Не удалось разобрать URL:', tab.url);
        }
      }
    });
    
    // Закрываем найденные вкладки
    if (tabsToClose.length > 0) {
      chrome.tabs.remove(tabsToClose, function() {
        if (chrome.runtime.lastError) {
          console.log('Ошибка при закрытии вкладок:', chrome.runtime.lastError);
          sendResponse({ 
            success: false, 
            closedCount: 0,
            message: 'Ошибка при закрытии вкладок' 
          });
        } else {
          sendResponse({ 
            success: true, 
            closedCount: tabsToClose.length,
            domain: normalizedDomain 
          });
        }
      });
    } else {
      sendResponse({ 
        success: false, 
        closedCount: 0,
        message: `Вкладки с доменом ${normalizedDomain} не найдены` 
      });
    }
  });
}

// Контекстное меню (опционально)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'closeDomainTabsFromContext',
    title: 'Закрыть все вкладки этого домена',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'closeDomainTabsFromContext' && tab.url) {
    try {
      const url = new URL(tab.url);
      const domain = url.hostname;
      
      closeTabsByDomain(domain, 'all', false, function(response) {
        console.log('Закрыто вкладок:', response ? response.closedCount : 0);
      });
    } catch (e) {
      console.error('Ошибка:', e);
    }
  }
});