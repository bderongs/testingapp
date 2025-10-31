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
        const label = labelNode ? labelNode.innerText.trim() : undefined;
        const type = isInput ? element.type : element.tagName.toLowerCase();
        const name = element.name || element.id || '';
        if (!name && !label) {
          return null;
        }
        return {
          name,
          type,
          label,
          required: element.hasAttribute('required'),
        };
      })
      .filter((field) => Boolean(field));

    return {
      action: form.action || '',
      method: (form.method || 'GET').toUpperCase(),
      fields,
    };
  });

  const interactiveElements = document.querySelectorAll(
    'button, [role="button"], a[role="button"], input[type="button"], input[type="submit"], [data-action]'
  );

  const scrollableSections = Array.from(document.querySelectorAll('section, main, article, div')).filter(
    (element) => element.scrollHeight > window.innerHeight * 1.2
  );

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

  const headingElements = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
  const headingOutline = headingElements
    .map((heading) => {
      const level = Number.parseInt(heading.tagName.replace('H', ''), 10);
      const text = heading.innerText.trim();
      if (!text) {
        return null;
      }
      return { level, text, id: heading.id || undefined };
    })
    .filter((entry) => Boolean(entry));

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
  };
})()
`;
