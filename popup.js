document.addEventListener('DOMContentLoaded', function() {
  const domainInput = document.getElementById('domainInput');
  const closeBtn = document.getElementById('closeBtn');
  const statusDiv = document.getElementById('status');
  const currentDomainsDiv = document.getElementById('currentDomains');
  const historyDiv = document.getElementById('history');
  const refreshDomainsBtn = document.getElementById('refreshDomainsBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const closePinnedCheckbox = document.getElementById('closePinnedCheckbox');
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  let currentDomainGroups = [];
  const expandedRoots = new Set();

  function normalizeHostnameForDisplay(hostname) {
    return (hostname || '')
      .toLowerCase()
      .trim()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  }

  function getRootDomain(hostname) {
    const clean = normalizeHostnameForDisplay(hostname);
    if (!clean) return '';
    const parts = clean.split('.').filter(Boolean);
    if (parts.length <= 2) return clean;
    return parts.slice(-2).join('.');
  }

  function getMatchLabel(match) {
    switch (match) {
      case 'exact':
        return 'только этот домен';
      case 'subdomains':
        return 'только поддомены';
      case 'all':
      default:
        return 'домен и поддомены';
    }
  }
  
  // Функция для перехода на вкладку по домену
  function switchToTabByDomain(domain, match = 'exact') {
    chrome.tabs.query({}, function(tabs) {
      let targetTab = null;
      
      for (const tab of tabs) {
        if (!tab.url) continue;
        if (!(tab.url.startsWith('http:') || tab.url.startsWith('https:'))) continue;
        
        try {
          const url = new URL(tab.url);
          const hostname = normalizeHostnameForDisplay(url.hostname);
          
          let shouldSwitch = false;
          
          switch (match) {
            case 'exact':
              shouldSwitch = hostname === domain;
              break;
            case 'subdomains':
              shouldSwitch = hostname !== domain && hostname.endsWith(`.${domain}`);
              break;
            case 'all':
              shouldSwitch = hostname === domain || hostname.endsWith(`.${domain}`);
              break;
          }
          
          if (shouldSwitch) {
            targetTab = tab;
            break;
          }
        } catch (e) {
          console.log('Не удалось разобрать URL:', tab.url);
        }
      }
      
      if (targetTab) {
        chrome.tabs.update(targetTab.id, { active: true });
        chrome.windows.update(targetTab.windowId, { focused: true });
        showStatus(`✅ Переход на ${domain}`, 'success');
      } else {
        showStatus(`❌ Вкладки с доменом ${domain} не найдены`, 'error');
      }
    });
  }
  
  // Функция для получения первой вкладки по домену (для подсветки и перехода)
  function getFirstTabByDomain(domain, match = 'exact') {
    return new Promise((resolve) => {
      chrome.tabs.query({}, function(tabs) {
        let targetTab = null;
        
        for (const tab of tabs) {
          if (!tab.url) continue;
          if (!(tab.url.startsWith('http:') || tab.url.startsWith('https:'))) continue;
          
          try {
            const url = new URL(tab.url);
            const hostname = normalizeHostnameForDisplay(url.hostname);
            
            let shouldMatch = false;
            
            switch (match) {
              case 'exact':
                shouldMatch = hostname === domain;
                break;
              case 'subdomains':
                shouldMatch = hostname !== domain && hostname.endsWith(`.${domain}`);
                break;
              case 'all':
                shouldMatch = hostname === domain || hostname.endsWith(`.${domain}`);
                break;
            }
            
            if (shouldMatch) {
              targetTab = tab;
              break;
            }
          } catch (e) {
            console.log('Не удалось разобрать URL:', tab.url);
          }
        }
        
        resolve(targetTab);
      });
    });
  }
  
  loadCurrentDomains();
  loadHistory();
  setupTabs();
  
  function loadCurrentDomains() {
    chrome.tabs.query({}, function(tabs) {
      const groupsMap = new Map();

      tabs.forEach(tab => {
        if (!tab.url) return;
        if (!(tab.url.startsWith('http:') || tab.url.startsWith('https:'))) return;

        try {
          const url = new URL(tab.url);
          const hostname = normalizeHostnameForDisplay(url.hostname);
          if (!hostname) return;

          const root = getRootDomain(hostname);
          if (!groupsMap.has(root)) {
            groupsMap.set(root, {
              root: root,
              favicon: `https://www.google.com/s2/favicons?domain=${root}&sz=16`,
              totalCount: 0,
              baseCount: 0,
              subdomainsMap: new Map(),
              firstTabId: null,
              firstTabWindowId: null
            });
          }

          const group = groupsMap.get(root);
          
          // Сохраняем первую попавшуюся вкладку для корневого домена
          if (group.firstTabId === null && hostname === root) {
            group.firstTabId = tab.id;
            group.firstTabWindowId = tab.windowId;
          }
          
          group.totalCount++;

          if (hostname === root) {
            group.baseCount++;
          } else {
            if (!group.subdomainsMap.has(hostname)) {
              group.subdomainsMap.set(hostname, { 
                hostname: hostname, 
                count: 0,
                firstTabId: null,
                firstTabWindowId: null
              });
            }
            const subdomain = group.subdomainsMap.get(hostname);
            if (subdomain.firstTabId === null) {
              subdomain.firstTabId = tab.id;
              subdomain.firstTabWindowId = tab.windowId;
            }
            subdomain.count++;
          }
        } catch (e) {
          console.log('Не удалось разобрать URL:', tab.url);
        }
      });

      currentDomainGroups = Array.from(groupsMap.values())
        .map(group => {
          const children = Array.from(group.subdomainsMap.values())
            .sort((a, b) => b.count - a.count);
          return {
            ...group,
            subdomainsCount: group.totalCount - group.baseCount,
            children: children
          };
        })
        .sort((a, b) => b.totalCount - a.totalCount);

      renderCurrentDomains();
    });
  }
  
  function renderCurrentDomains() {
    if (currentDomainGroups.length === 0) {
      currentDomainsDiv.innerHTML = '<div class="no-domains">📭 Нет открытых вкладок</div>';
      return;
    }

    currentDomainsDiv.innerHTML = '';

    const activeDomain = normalizeHostnameForDisplay(domainInput.value);

    currentDomainGroups.forEach(group => {
      const groupWrapper = document.createElement('div');

      const rootRow = document.createElement('div');
      rootRow.className = 'domain-item domain-root';
      rootRow.dataset.domain = group.root;
      if (activeDomain && activeDomain === group.root) rootRow.classList.add('active');

      // Клик по строке домена для перехода на вкладку
      rootRow.onclick = function(e) {
        if (e.target.closest('.actions') || e.target.closest('.toggle-btn')) return;
        domainInput.value = group.root;
        highlightDomain(group.root);
        // Переход на вкладку
        if (group.firstTabId) {
          chrome.tabs.update(group.firstTabId, { active: true });
          chrome.windows.update(group.firstTabWindowId, { focused: true });
          showStatus(`✅ Переход на ${group.root}`, 'success');
        } else {
          switchToTabByDomain(group.root, 'all');
        }
      };

      const domainInfoDiv = document.createElement('div');
      domainInfoDiv.className = 'domain-info';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'toggle-btn';
      toggleBtn.title = group.children.length ? 'Показать/скрыть поддомены' : 'Нет поддоменов';
      toggleBtn.disabled = group.children.length === 0;
      toggleBtn.textContent = expandedRoots.has(group.root) ? '▼' : '▶';
      toggleBtn.onclick = function(e) {
        e.stopPropagation();
        if (group.children.length === 0) return;
        if (expandedRoots.has(group.root)) expandedRoots.delete(group.root);
        else expandedRoots.add(group.root);
        renderCurrentDomains();
      };

      const favicon = document.createElement('img');
      favicon.className = 'favicon';
      favicon.src = group.favicon;
      favicon.onerror = function() {
        this.src = `https://www.google.com/s2/favicons?domain=${group.root}&sz=16`;
      };

      const domainName = document.createElement('span');
      domainName.className = 'domain-name';
      domainName.textContent = group.root;
      domainName.title = `Нажмите для перехода на ${group.root}`;
      domainName.style.cursor = 'pointer';

      const tabCount = document.createElement('span');
      tabCount.className = 'tab-count';
      tabCount.textContent = group.totalCount;
      tabCount.title = `Вкладок: основной ${group.baseCount}, поддомены ${group.subdomainsCount}`;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';

      const baseCloseBtn = document.createElement('button');
      baseCloseBtn.className = 'action-btn btn-root';
      baseCloseBtn.innerHTML = '<span class="action-icon">🏠</span>';
      baseCloseBtn.title = `Закрыть только ${group.root} (${group.baseCount} вкладок)`;
      baseCloseBtn.onclick = function(e) {
        e.stopPropagation();
        closeDomainTabs(group.root, 'exact');
      };

      const subCloseBtn = document.createElement('button');
      subCloseBtn.className = 'action-btn btn-sub';
      subCloseBtn.innerHTML = '<span class="action-icon">🌿</span>';
      subCloseBtn.title = `Закрыть поддомены ${group.root} (${group.subdomainsCount} вкладок)`;
      subCloseBtn.onclick = function(e) {
        e.stopPropagation();
        closeDomainTabs(group.root, 'subdomains');
      };

      const allCloseBtn = document.createElement('button');
      allCloseBtn.className = 'action-btn btn-all';
      allCloseBtn.innerHTML = '<span class="action-icon">🗑️</span>';
      allCloseBtn.title = `Закрыть ${group.root} и все поддомены (${group.totalCount} вкладок)`;
      allCloseBtn.onclick = function(e) {
        e.stopPropagation();
        closeDomainTabs(group.root, 'all');
      };

      actionsDiv.appendChild(baseCloseBtn);
      actionsDiv.appendChild(subCloseBtn);
      actionsDiv.appendChild(allCloseBtn);

      domainInfoDiv.appendChild(toggleBtn);
      domainInfoDiv.appendChild(favicon);
      domainInfoDiv.appendChild(domainName);
      domainInfoDiv.appendChild(tabCount);

      rootRow.appendChild(domainInfoDiv);
      rootRow.appendChild(actionsDiv);

      groupWrapper.appendChild(rootRow);

      if (group.children.length > 0) {
        const subdomainsContainer = document.createElement('div');
        subdomainsContainer.className = 'subdomains-container' + (expandedRoots.has(group.root) ? ' expanded' : '');

        group.children.forEach(child => {
          const childItem = document.createElement('div');
          childItem.className = 'domain-item domain-child';
          childItem.dataset.domain = child.hostname;
          if (activeDomain && activeDomain === child.hostname) childItem.classList.add('active');

          // Клик по поддомену для перехода на вкладку
          childItem.onclick = function(e) {
            if (e.target.closest('.actions')) return;
            domainInput.value = child.hostname;
            highlightDomain(child.hostname);
            // Переход на вкладку поддомена
            if (child.firstTabId) {
              chrome.tabs.update(child.firstTabId, { active: true });
              chrome.windows.update(child.firstTabWindowId, { focused: true });
              showStatus(`✅ Переход на ${child.hostname}`, 'success');
            } else {
              switchToTabByDomain(child.hostname, 'exact');
            }
          };

          const childInfoDiv = document.createElement('div');
          childInfoDiv.className = 'domain-info';

          const childFavicon = document.createElement('img');
          childFavicon.className = 'favicon';
          childFavicon.src = `https://www.google.com/s2/favicons?domain=${child.hostname}&sz=16`;
          childFavicon.onerror = function() {
            this.src = `https://www.google.com/s2/favicons?domain=${child.hostname}&sz=16`;
          };

          const childName = document.createElement('span');
          childName.className = 'domain-name';
          childName.textContent = child.hostname;
          childName.title = `Нажмите для перехода на ${child.hostname}`;
          childName.style.cursor = 'pointer';

          const childTabCount = document.createElement('span');
          childTabCount.className = 'tab-count';
          childTabCount.textContent = child.count;

          childInfoDiv.appendChild(childFavicon);
          childInfoDiv.appendChild(childName);
          childInfoDiv.appendChild(childTabCount);

          const childActionsDiv = document.createElement('div');
          childActionsDiv.className = 'actions';

          const closeChildBtn = document.createElement('button');
          closeChildBtn.className = 'action-btn btn-root';
          closeChildBtn.innerHTML = '<span class="action-icon">✖️</span>';
          closeChildBtn.title = `Закрыть ${child.hostname} (${child.count} вкладок)`;
          closeChildBtn.onclick = function(e) {
            e.stopPropagation();
            closeDomainTabs(child.hostname, 'exact');
          };

          childActionsDiv.appendChild(closeChildBtn);

          childItem.appendChild(childInfoDiv);
          childItem.appendChild(childActionsDiv);

          subdomainsContainer.appendChild(childItem);
        });

        groupWrapper.appendChild(subdomainsContainer);
      }

      currentDomainsDiv.appendChild(groupWrapper);
    });
  }
  
  function highlightDomain(domain) {
    const normalized = normalizeHostnameForDisplay(domain);
    const items = currentDomainsDiv.querySelectorAll('.domain-item[data-domain]');
    items.forEach(item => {
      if (item.dataset.domain === normalized) item.classList.add('active');
      else item.classList.remove('active');
    });
  }
  
  function loadHistory() {
    chrome.storage.local.get(['domainHistory'], function(result) {
      const history = result.domainHistory || [];
      renderHistory(history);
    });
  }
  
  function renderHistory(history) {
    if (history.length === 0) {
      historyDiv.innerHTML = '<div class="no-domains">📭 История пуста</div>';
      return;
    }
    
    historyDiv.innerHTML = '';
    
    history.forEach(domain => {
      const item = document.createElement('div');
      item.className = 'history-item';
      
      const domainSpan = document.createElement('span');
      domainSpan.className = 'domain-name';
      domainSpan.textContent = domain;
      domainSpan.style.cursor = 'pointer';
      domainSpan.title = `Нажмите для перехода на ${domain}`;
      domainSpan.onclick = function() {
        domainInput.value = domain;
        switchToTab('current');
        highlightDomain(domain);
        // Переход на вкладку из истории
        switchToTabByDomain(domain, 'all');
      };
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'action-btn btn-root';
      removeBtn.innerHTML = '<span class="action-icon">✖️</span>';
      removeBtn.title = 'Удалить из истории';
      removeBtn.style.padding = '4px 8px';
      removeBtn.onclick = function(e) {
        e.stopPropagation();
        removeFromHistory(domain);
        item.remove();
        
        if (historyDiv.children.length === 0) {
          historyDiv.innerHTML = '<div class="no-domains">📭 История пуста</div>';
        }
      };
      
      item.appendChild(domainSpan);
      item.appendChild(removeBtn);
      historyDiv.appendChild(item);
    });
  }
  
  function removeFromHistory(domain) {
    chrome.storage.local.get(['domainHistory'], function(result) {
      const history = result.domainHistory || [];
      const index = history.indexOf(domain);
      if (index > -1) {
        history.splice(index, 1);
        chrome.storage.local.set({ domainHistory: history });
      }
    });
  }
  
  function setupTabs() {
    tabs.forEach(tab => {
      tab.addEventListener('click', function() {
        const tabId = this.getAttribute('data-tab');
        
        tabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        tabContents.forEach(content => {
          content.classList.remove('active');
          if (content.id === `${tabId}TabContent`) {
            content.classList.add('active');
          }
        });
      });
    });
  }
  
  function switchToTab(tabName) {
    tabs.forEach(tab => {
      if (tab.getAttribute('data-tab') === tabName) {
        tab.click();
      }
    });
  }
  
  function closeDomainTabs(domain, match) {
    const safeDomain = (domain || '').trim();
    const safeMatch = match || 'all';

    chrome.runtime.sendMessage({
      action: 'closeTabsByDomain',
      domain: safeDomain,
      match: safeMatch,
      closePinned: !!(closePinnedCheckbox && closePinnedCheckbox.checked)
    }, function(response) {
      if (response && response.success) {
        showStatus(
          `✅ Закрыто ${response.closedCount} вкладок (${getMatchLabel(safeMatch)})`,
          'success'
        );
        domainInput.value = '';
        
        setTimeout(loadCurrentDomains, 300);
        
        addToHistory(safeDomain);
      } else if (response) {
        showStatus(response.message || '❌ Произошла ошибка', 'error');
      }
    });
  }
  
  function addToHistory(domain) {
    chrome.storage.local.get(['domainHistory'], function(result) {
      const history = result.domainHistory || [];
      if (!history.includes(domain)) {
        history.unshift(domain);
        if (history.length > 20) history.pop();
        chrome.storage.local.set({ domainHistory: history });
        loadHistory();
      }
    });
  }
  
  closeBtn.addEventListener('click', function() {
    const domain = domainInput.value.trim();
    
    if (!domain) {
      showStatus('⚠️ Введите домен', 'error');
      return;
    }
    
    closeDomainTabs(domain, 'all');
  });
  
  domainInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      closeBtn.click();
    }
  });
  
  refreshDomainsBtn.addEventListener('click', function() {
    loadCurrentDomains();
    showStatus('🔄 Список обновлен', 'info');
  });
  
  clearHistoryBtn.addEventListener('click', function() {
    if (confirm('Очистить всю историю доменов?')) {
      chrome.storage.local.set({ domainHistory: [] }, function() {
        renderHistory([]);
        showStatus('✅ История очищена', 'success');
      });
    }
  });
  
  function showStatus(message, type) {
    statusDiv.textContent = message;
    
    switch(type) {
      case 'error':
        statusDiv.style.color = '#d32f2f';
        statusDiv.style.backgroundColor = '#ffebee';
        break;
      case 'success':
        statusDiv.style.color = '#2e7d32';
        statusDiv.style.backgroundColor = '#e8f5e9';
        break;
      case 'info':
        statusDiv.style.color = '#555';
        statusDiv.style.backgroundColor = '#f5f5f5';
        break;
    }
    
    setTimeout(function() {
      statusDiv.textContent = '';
      statusDiv.style.backgroundColor = '';
    }, 3000);
  }
});