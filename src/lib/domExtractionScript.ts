// This file holds the plain JavaScript snippet executed inside the page context to extract structured metadata.

export const DOM_EXTRACTION_SOURCE = `
(() => {
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const links = anchors
    .filter((anchor) => anchor.href && !anchor.href.toLowerCase().startsWith('javascript:'))
    .map((anchor) => {
      const textOptions = [anchor.innerText, anchor.getAttribute('aria-label'), anchor.textContent];
      const text = textOptions
        .map((value) => (value || '').trim())
        .find((value) => value.length > 0) || '';
      return { url: anchor.href, text };
    });

  const forms = Array.from(document.querySelectorAll('form'));
  const formSummaries = forms.map((form) => {
    const elements = Array.from(form.elements);
    const fields = elements
      .map((element) => {
        const isInput = element instanceof HTMLInputElement;
        const isTextArea = element instanceof HTMLTextAreaElement;
        const isSelect = element instanceof HTMLSelectElement;
        if (!isInput && !isTextArea && !isSelect) {
          return null;
        }
        const labelNode = element.labels && element.labels[0];
        const labelFromNode = labelNode ? labelNode.innerText.trim() : '';
        const ariaAttr = element.getAttribute ? element.getAttribute('aria-label') : null;
        const placeholderAttr = element.getAttribute ? element.getAttribute('placeholder') : null;
        const ariaLabel = ariaAttr ? ariaAttr.trim() : '';
        const placeholder = placeholderAttr ? placeholderAttr.trim() : '';
        const label = labelFromNode || ariaLabel || placeholder || undefined;
        const type = isInput ? element.type : element.tagName.toLowerCase();
        const nameCandidate = element.name || element.id || ariaLabel || placeholder || '';
        if (!nameCandidate && !label) {
          return null;
        }
        
        // For select elements, capture the available options
        let options = undefined;
        if (isSelect) {
          const optionElements = Array.from(element.options || []);
          options = optionElements.map((opt) => ({
            value: opt.value,
            label: opt.textContent?.trim() || opt.value,
          })).filter((opt) => opt.value || opt.label);
        }
        
        return {
          name: nameCandidate,
          type,
          label,
          placeholder: placeholder || undefined,
          required: element.hasAttribute('required'),
          options,
        };
      })
      .filter((field) => Boolean(field));

    return {
      action: form.action || '',
      method: (form.method || 'GET').toUpperCase(),
      fields,
    };
  });

  const interactiveCandidates = new Set();

  Array.from(
    document.querySelectorAll('button, [role="button"], a[role="button"], input[type="button"], input[type="submit"], [data-action]')
  ).forEach((element) => interactiveCandidates.add(element));

  const anchorButtons = Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
    const className = (anchor.className || '').toLowerCase();
    const dataAttributes = [anchor.getAttribute('data-action'), anchor.getAttribute('data-cta')].filter(Boolean).length > 0;
    const buttonLikeClass = /btn|button|cta|primary|action|submit/.test(className);
    const explicitButtonRole = anchor.getAttribute('role') === 'button';
    const isNavItem = Boolean(anchor.closest('nav'));

    if (isNavItem) {
      return false;
    }

    return buttonLikeClass || dataAttributes || explicitButtonRole;
  });

  anchorButtons.forEach((anchor) => interactiveCandidates.add(anchor));

  const interactiveElements = Array.from(interactiveCandidates);

  const scrollableSections = Array.from(document.querySelectorAll('section, main, article, div')).filter(
    (element) => element.scrollHeight > window.innerHeight * 1.2
  );

  const extractCtaLabel = (element) => {
    if (!element) {
      return '';
    }

    const datasetValues = [];
    if (element.dataset) {
      Object.keys(element.dataset).forEach((key) => {
        const value = element.dataset[key];
        if (value) {
          datasetValues.push(value);
        }
      });
    }

    const candidates = [
      element.innerText,
      element.getAttribute && element.getAttribute('aria-label'),
      element.getAttribute && element.getAttribute('title'),
      element.value,
      ...datasetValues,
    ];

    for (const raw of candidates) {
      const text = (raw || '').trim();
      if (text.length > 0) {
        return text;
      }
    }

    return '';
  };

  const escapeIdentifier = (value) => {
    if (!value) {
      return '';
    }
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, (char) => '\\\\' + char.charCodeAt(0).toString(16) + ' ');
  };

  const buildCssSelector = (element) => {
    if (!element || !(element instanceof Element)) {
      return '';
    }
    if (element.id) {
      // For IDs, we can use CSS.escape if available
      const escapedId = window.CSS && typeof window.CSS.escape === 'function' 
        ? window.CSS.escape(element.id)
        : element.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      return '#' + escapedId;
    }

    const parts = [];
    let current = element;
    let depth = 0;

    while (current && current !== document.body && depth < 4) {
      let part = current.tagName.toLowerCase();
      const classList = (current.className || '')
        .split(/\s+/)
        .filter(Boolean)
        .filter((cls) => /^[a-zA-Z_-]/.test(cls)) // Only valid CSS class names
        .slice(0, 2)
        .map((cls) => {
          // Sanitize class name: keep alphanumeric, hyphens, underscores, and escape colons
          return '.' + cls.replace(/:/g, '\\:');
        })
        .join('');

      if (classList) {
        part += classList;
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(
          (sibling) => sibling.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          part += ':nth-of-type(' + (index + 1) + ')';
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }

    return parts.join(' > ');
  };

  const ctaMap = new Map();
  const mainContent = document.querySelector('main, [role="main"]');
  
  interactiveElements.forEach((element) => {
    const label = extractCtaLabel(element);
    if (!label) {
      return;
    }

    const normalized = label
      .replace(/\s+/g, ' ')
      .trim();

    if (normalized.length === 0 || normalized.length > 60) {
      return;
    }

    // Determine element type and location
    const isButton = element.tagName === 'BUTTON' || element.getAttribute('role') === 'button' || element.tagName === 'INPUT' && (element.type === 'button' || element.type === 'submit');
    const isLink = element.tagName === 'A' && element.href;
    const elementType = isButton ? 'button' : isLink ? 'link' : 'unknown';
    
    // Check if CTA is in main content area
    const isInMainContent = mainContent && mainContent.contains(element);
    
    // Calculate priority score with multiple factors
    let priority = 0;
    
    // Highest priority: Submit buttons (primary form actions)
    const isSubmitButton = (element.tagName === 'BUTTON' && element.type === 'submit') || 
                           (element.tagName === 'INPUT' && element.type === 'submit');
    if (isSubmitButton) {
      priority += 50; // Submit buttons are almost always the primary action
    }
    
    // High priority: CTAs in main content
    if (isInMainContent) {
      priority += 10;
    }
    
    // Medium priority: Primary action keywords in button text
    const lowerLabel = normalized.toLowerCase();
    if (/(create|submit|save|send|confirm|continue|sign in|log in|register|buy|purchase|checkout|dashboard|tableau de bord)/i.test(lowerLabel)) {
      priority += 5;
    }
    
    // Deprioritize secondary actions
    if (/(another|more|additional|cancel|back|skip)/i.test(lowerLabel)) {
      priority -= 10;
    }
    
    // Store metadata about this CTA
    if (!ctaMap.has(normalized) || ctaMap.get(normalized).priority < priority) {
      ctaMap.set(normalized, {
        label: normalized,
        elementType,
        isInMainContent: Boolean(isInMainContent),
        priority,
      });
    }
  });

  const primaryCtas = Array.from(ctaMap.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);

  const detectActionCategory = (label) => {
    const normalized = label.toLowerCase();
    const fold = normalized.normalize('NFD').replace(/\\p{M}/gu, '');

    const ruleGroups = [
      { category: 'create', score: 60, patterns: ['create', 'new', 'add', 'start', 'launch', 'setup', 'build', 'ajouter', 'nouveau', 'creer', 'demarrer'] },
      { category: 'delete', score: 70, patterns: ['delete', 'remove', 'trash', 'archive', 'supprimer', 'retirer', 'annuler'] },
      { category: 'update', score: 55, patterns: ['edit', 'update', 'modify', 'change', 'manage', 'configurer', 'modifier'] },
      { category: 'invite', score: 65, patterns: ['invite', 'add member', 'add user', 'share with', 'inviter'] },
      { category: 'share', score: 50, patterns: ['share', 'copy link', 'send link', 'export', 'shareable'] },
      { category: 'settle', score: 58, patterns: ['settle', 'pay', 'split', 'balance', 'rembourser', 'payer'] },
      { category: 'search', score: 45, patterns: ['search', 'find', 'look up', 'chercher'] },
      { category: 'filter', score: 45, patterns: ['filter', 'sort', 'refine', 'filtrer'] },
      { category: 'navigate', score: 30, patterns: ['view', 'open', 'details', 'voir', 'consulter', 'dashboard', 'tableau de bord'] },
    ];

    let bestMatch = { category: 'other', score: 0 };

    ruleGroups.forEach((group) => {
      const matched = group.patterns.some((pattern) => {
        const lowered = pattern.toLowerCase();
        const foldedPattern = lowered.normalize('NFD').replace(/\\p{M}/gu, '');
        return normalized.includes(lowered) || fold.includes(foldedPattern) || fold.replace(/\\s+/g, '').includes(foldedPattern.replace(/\\s+/g, ''));
      });
      if (matched && group.score > bestMatch.score) {
        bestMatch = { category: group.category, score: group.score };
      }
    });

    return bestMatch;
  };

  const detectActionLocation = (element, mainContent) => {
    if (!element) {
      return 'unknown';
    }
    if (element.closest('nav, [role="navigation"]')) {
      return 'navigation';
    }
    if (element.closest('header, [role="banner"]')) {
      return 'header';
    }
    if (element.closest('footer, [role="contentinfo"]')) {
      return 'footer';
    }
    if (element.closest('[role="dialog"], [data-modal], .modal, .dialog')) {
      return 'modal';
    }
    if (mainContent && mainContent.contains(element)) {
      return 'main';
    }
    return 'unknown';
  };

  const inferElementType = (element) => {
    if (!element) {
      return 'unknown';
    }
    if (element.tagName === 'BUTTON') {
      return 'button';
    }
    if (element.tagName === 'A') {
      return 'link';
    }
    if (element.tagName === 'INPUT') {
      return element.type === 'submit' || element.type === 'button' ? 'button' : 'input';
    }
    if (element.getAttribute('role') === 'button') {
      return 'button';
    }
    return 'unknown';
  };

  const collectSupportingText = (element) => {
    if (!element) {
      return [];
    }
    const supports = new Set();

    const addText = (text) => {
      if (!text) {
        return;
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      const compressed = trimmed.replace(/\\s+/g, ' ');
      if (compressed.length === 0 || compressed.length > 100) {
        return;
      }
      supports.add(compressed);
    };

    const labeledBy = element.getAttribute('aria-labelledby');
    if (labeledBy) {
      labeledBy.split(' ').forEach((id) => {
        const ref = document.getElementById(id);
        if (ref) {
          addText(ref.innerText || ref.textContent || '');
        }
      });
    }

    const describedBy = element.getAttribute('aria-describedby');
    if (describedBy) {
      describedBy.split(' ').forEach((id) => {
        const ref = document.getElementById(id);
        if (ref) {
          addText(ref.innerText || ref.textContent || '');
        }
      });
    }

    const datasetValues = element.dataset ? Object.values(element.dataset) : [];
    datasetValues.forEach(addText);

    const enclosingForm = element.closest('form');
    if (enclosingForm) {
      if (enclosingForm.getAttribute('name')) {
        addText(enclosingForm.getAttribute('name'));
      }
      if (enclosingForm.getAttribute('data-testid')) {
        addText(enclosingForm.getAttribute('data-testid'));
      }
      const legend = enclosingForm.querySelector('legend');
      if (legend) {
        addText(legend.innerText || legend.textContent || '');
      }
    }

    const heading = element.closest('section, article, form, div')?.querySelector('h1, h2, h3, h4');
    if (heading) {
      addText(heading.innerText || heading.textContent || '');
    }

    const siblingHeading = (() => {
      let candidate = element.parentElement;
      while (candidate && candidate !== document.body) {
        const headingNode = candidate.querySelector('h1, h2, h3, h4');
        if (headingNode) {
          return headingNode;
        }
        candidate = candidate.parentElement;
      }
      return null;
    })();
    if (siblingHeading && siblingHeading !== heading) {
      addText(siblingHeading.innerText || siblingHeading.textContent || '');
    }

    const immediateLabel = element.getAttribute('aria-label') || element.getAttribute('title');
    addText(immediateLabel);

    return Array.from(supports).slice(0, 4);
  };

  const actionHints = interactiveElements
    .map((element) => {
      const label = extractCtaLabel(element);
      if (!label) {
        return null;
      }

      const { category, score } = detectActionCategory(label);
      let confidence = score;

      const className = (element.className || '').toLowerCase();
      if (/primary|danger|success|warning|submit|cta|action/.test(className)) {
        confidence += 5;
      }
      if (element.hasAttribute('data-action') || element.hasAttribute('data-testid')) {
        confidence += 4;
      }
      if (element.closest('form')) {
        confidence += 6;
      }
      if (category === 'other' && confidence < 25) {
        confidence = 20;
      }

      const elementType = inferElementType(element);
      if (elementType === 'button') {
        confidence += 3;
      }

      const location = detectActionLocation(element, mainContent);
      if (location === 'main') {
        confidence += 3;
      }

      return {
        label,
        category,
        elementType,
        confidence: Math.min(confidence, 100),
        location,
        supportingText: collectSupportingText(element),
        selector: buildCssSelector(element),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.label.localeCompare(b.label);
    });

  const landmarks = [];
  if (document.querySelector('header, [role="banner"]')) landmarks.push('banner');
  if (document.querySelector('nav, [role="navigation"]')) landmarks.push('navigation');
  if (document.querySelector('main, [role="main"]')) landmarks.push('main');
  if (document.querySelector('aside, [role="complementary"]')) landmarks.push('complementary');
  if (document.querySelector('footer, [role="contentinfo"]')) landmarks.push('contentinfo');
  if (document.querySelector('[role="search"], form[role="search"], input[type="search"]')) landmarks.push('search');

  const navigationRoots = Array.from(new Set(document.querySelectorAll('nav, [role="navigation"]')));
  const navigationSections = navigationRoots.map((root) => {
    const label = root.getAttribute('aria-label') || root.getAttribute('data-testid') || undefined;
    const navLinks = Array.from(root.querySelectorAll('a[href]'));
    const seen = new Set();
    const items = navLinks
      .map((link) => {
        let depth = 0;
        let current = link.parentElement;
        while (current && current !== root) {
          const tag = current.tagName.toLowerCase();
          if (tag === 'ul' || tag === 'ol' || tag === 'nav') {
            depth += 1;
          }
          current = current.parentElement;
        }
        const textOptions = [link.innerText, link.getAttribute('aria-label'), link.textContent];
        const text = textOptions
          .map((value) => (value || '').trim())
          .find((value) => value.length > 0) || '';
        return { url: link.href, text, depth };
      })
      .filter((item) => {
        const signature = item.depth + '|' + item.url + '|' + item.text;
        if (seen.has(signature)) {
          return false;
        }
        seen.add(signature);
        return item.text.length > 0 && item.url.length > 0;
      });

    return { label, items };
  });

  // Helper to check if element is visible
  const isElementVisible = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    // Check if element is in viewport or at least partially visible
    const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
    // Also check if it's not in a hidden container (like a closed modal)
    const isInHiddenContainer = element.closest('[style*="display: none"], [style*="visibility: hidden"]') !== null;
    return isInViewport && !isInHiddenContainer;
  };

  // Helper to check if element is in main content area
  const isInMainContent = (element) => {
    const mainContent = document.querySelector('main, [role="main"], article, [role="article"]');
    if (!mainContent) {
      return true; // If no main content area, consider all headings as valid
    }
    return mainContent.contains(element);
  };

  // Helper to check if element is in header/footer (usually not primary content)
  const isInHeaderOrFooter = (element) => {
    return element.closest('header, footer, [role="banner"], [role="contentinfo"]') !== null;
  };

  const headingElements = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
  const headingOutline = headingElements
    .filter((heading) => {
      // Filter out headings that are not visible
      if (!isElementVisible(heading)) {
        return false;
      }
      // Prefer headings in main content, but don't exclude others completely
      // (some pages don't have a main tag)
      return true;
    })
    .map((heading) => {
      const level = Number.parseInt(heading.tagName.replace('H', ''), 10);
      const text = heading.innerText.trim();
      if (!text) {
        return null;
      }
      const inMain = isInMainContent(heading);
      const inHeaderFooter = isInHeaderOrFooter(heading);
      const rect = heading.getBoundingClientRect();
      // Headings near the top of the page (first 2000px) are more likely to be primary
      const isNearTop = rect.top >= 0 && rect.top < 2000;
      // Calculate priority: main content + near top + h1 gets highest priority
      let priority = 0;
      if (inMain) priority += 10;
      if (isNearTop) priority += 5;
      if (level === 1) priority += 3;
      if (inHeaderFooter) priority -= 5; // Penalize header/footer headings
      
      return { 
        level, 
        text, 
        id: heading.id || undefined,
        inMainContent: inMain,
        inHeaderFooter: inHeaderFooter,
        priority: priority
      };
    })
    .filter((entry) => Boolean(entry))
    // Sort by priority (main content first), then by level (h1 first), then by position
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      if (a.level !== b.level) {
        return a.level - b.level; // Lower level (h1) comes first
      }
      return 0; // Keep original order for same level
    })
    // Remove priority from final output (not needed in the result)
    .map(({ priority, inMainContent, inHeaderFooter, ...rest }) => rest);

  const breadcrumbCandidates = Array.from(
    document.querySelectorAll(
      'nav[aria-label*="breadcrumb"], [role="navigation"][aria-label*="breadcrumb"], nav.breadcrumb, ol.breadcrumb, ul.breadcrumb'
    )
  );
  const breadcrumbContainer = breadcrumbCandidates.length > 0 ? breadcrumbCandidates[0] : null;
  const breadcrumbTrail = [];
  if (breadcrumbContainer) {
    const crumbLinks = Array.from(breadcrumbContainer.querySelectorAll('a[href]'));
    crumbLinks.forEach((link) => {
      const text = (link.innerText || link.textContent || '').trim();
      if (text) {
        breadcrumbTrail.push({ url: link.href, text });
      }
    });
    if (breadcrumbTrail.length === 0) {
      const crumbItems = Array.from(breadcrumbContainer.querySelectorAll('li'));
      crumbItems.forEach((item) => {
        const text = item.innerText.trim();
        if (text) {
          breadcrumbTrail.push({ url: '', text });
        }
      });
    }
  }

  const schemaOrgTypes = [];
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const recordType = (value) => {
    if (typeof value === 'string' && schemaOrgTypes.indexOf(value) === -1) {
      schemaOrgTypes.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(recordType);
    }
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, '@type')) {
      recordType(node['@type']);
    }
    Object.keys(node).forEach((key) => {
      const value = node[key];
      if (value && typeof value === 'object') {
        walk(value);
      }
    });
  };
  scripts.forEach((script) => {
    try {
      const data = JSON.parse(script.textContent || '{}');
      walk(data);
    } catch (error) {
      // Ignore malformed JSON-LD entries.
    }
  });

  const metaDescriptionElement = document.querySelector('meta[name="description"]');
  const metaDescription = metaDescriptionElement ? metaDescriptionElement.getAttribute('content') : undefined;

  const metaKeywordsElement = document.querySelector('meta[name="keywords"]');
  const metaKeywords = metaKeywordsElement ? metaKeywordsElement.getAttribute('content') : '';
  const keywordList = metaKeywords
    ? metaKeywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
        .slice(0, 12)
    : [];
  const headingKeywords = headingOutline
    .slice(0, 5)
    .map((entry) => entry ? entry.text : '')
    .filter((text) => text.length > 0);
  const primaryKeywords = keywordList.length > 0 ? keywordList : headingKeywords;

  return {
    title: document.title || '',
    links,
    forms: formSummaries,
    interactiveElementCount: interactiveElements.length,
    hasScrollableSections: scrollableSections.length > 0,
    landmarks,
    navigationSections,
    headingOutline,
    breadcrumbTrail,
    schemaOrgTypes,
    metaDescription: metaDescription ? metaDescription.trim() : undefined,
    primaryKeywords,
    primaryCtas,
    actionHints,
  };
})()
`;
