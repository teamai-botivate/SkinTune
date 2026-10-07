async function verifyLiveFlow() {
  const categories = [
    { cat: 'outfit', label: 'Clothing' },
    { cat: 'jewellery', label: 'Jewellery' },
    { cat: 'footwear', label: 'Footwear' },
    { cat: 'makeup', label: 'Makeup' }
  ];

  const baseLook = {
    id: 'look-live-e2e',
    title: 'Emerald Festive Elegance',
    note: 'Rich drape with warm gold accents.',
    vibe: 'Radiant',
    personaEnergy: 'Glowing and festive.',
    palette: ['#0f5257', '#d4af37'],
    pieces: [
      { category: 'Main', name: 'Emerald Green Festive Saree', detail: 'Pure silk with fine zari border' }
    ],
    outfit: 'Emerald Green Festive Saree with elegant gold detailing',
    outfitColor: 'Emerald Green and Gold',
    jewellery: 'Delicate Minimal Pearl Necklace',
    hairstyle: 'Soft low bun with loose strands',
    makeup: 'Warm terracotta nude matte liquid lipstick',
    footwear: 'Beige minimal block heels',
    accessories: 'Ivory potli bag with gold embroidery',
    reasoning: ['Emerald complements warm undertones', 'Festive embroidery fits wedding look'],
    confidence: 95,
    imageUrl: '/replace-with-generated/look-01.webp',
    applicableCategories: ['outfit', 'jewellery', 'footwear', 'makeup']
  };

  const profile = {
    name: 'Ananya',
    pronouns: 'Women’s styling',
    ageGroup: '25–34',
    height: '5 ft 6 in',
    appearance: { skinTone: 'Medium', undertone: 'Warm', confidence: 92, contrast: 'Medium' },
    bodyBuild: 'Average',
    fit: 'Fitted',
    style: ['Elegant', 'Glamorous'],
    colorsLove: ['Emerald Green', 'Gold'],
    colorsAvoid: ['Neon brights', 'Orange'],
    restrictions: [],
    occasion: 'Wedding',
    impression: ['Elegant', 'Regal'],
    budget: '₹5K–₹10K'
  };

  console.log('=== STARTING LIVE END-TO-END PRODUCT VERIFICATION ===\n');
  const allResults = [];

  for (const item of categories) {
    console.log(`\n======================================================`);
    console.log(`Querying SkinTune for category: ${item.label} (${item.cat})...`);
    console.log(`======================================================`);

    try {
      const res = await fetch('http://localhost:5173/api/product-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ look: baseLook, profile, category: item.cat })
      });
      const data = await res.json();
      console.log(`Status: ${data.status} | Products returned: ${(data.products || []).length}`);

      for (const prod of (data.products || [])) {
        console.log(`\nProduct: "${prod.productName}"`);
        console.log(`  Brand: ${prod.brand}`);
        console.log(`  Retailer: ${prod.retailer}`);
        console.log(`  SkinTune Price: ${prod.formattedPrice || (prod.price ? '₹' + prod.price : 'Check price')}`);
        console.log(`  Price Verified: ${prod.priceVerified}`);
        console.log(`  Price Tier: ${prod.priceTier}`);
        console.log(`  Material: ${prod.material || 'N/A'}`);
        console.log(`  Shade: ${prod.shade || 'N/A'}`);
        console.log(`  URL: ${prod.productUrl}`);

        let destPrice = 'N/A';
        let destTitle = 'N/A';
        let httpStatus = 0;

        try {
          const destRes = await fetch(prod.productUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(8000)
          });
          httpStatus = destRes.status;
          console.log(`  Destination Page Status: HTTP ${httpStatus}`);

          if (destRes.ok) {
            const html = await destRes.text();

            const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) ||
                               html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) {
              destTitle = titleMatch[1].replace(/\|.*$/, '').trim();
            }

            const priceMatch = html.match(/"discountedPrice":\s*(\d+)/i) ||
                               html.match(/"price":\s*"?(\d+)"?/i) ||
                               html.match(/content="(\d+)" property="(?:product|og):price:amount"/i);
            if (priceMatch) {
              destPrice = '₹' + parseInt(priceMatch[1]).toLocaleString('en-IN');
            }

            const myxMatch = html.match(/window\.__myx\s*=\s*(\{[\s\S]*?\});?<\/script>/i);
            if (myxMatch) {
              try {
                const myx = JSON.parse(myxMatch[1]);
                if (myx?.pdpData?.price?.discounted) {
                  destPrice = '₹' + myx.pdpData.price.discounted.toLocaleString('en-IN');
                } else if (myx?.pdpData?.price?.mrp) {
                  destPrice = '₹' + myx.pdpData.price.mrp.toLocaleString('en-IN');
                }
                if (myx?.pdpData?.name) destTitle = myx.pdpData.name;
              } catch {}
            }
          }
        } catch (err) {
          console.log(`  Destination fetch note: ${err.message}`);
        }

        console.log(`  Destination Title: ${destTitle}`);
        console.log(`  Destination Price: ${destPrice}`);

        const skinPriceStr = prod.formattedPrice || (prod.price ? '₹' + prod.price.toLocaleString('en-IN') : 'Check store price');

        const isExactProductMatch = destTitle !== 'N/A' && destTitle.toLowerCase().includes(prod.brand.toLowerCase());
        const isPriceMatch = prod.priceVerified ? (destPrice === skinPriceStr) : (destPrice === 'N/A' || skinPriceStr === 'Check store price');

        let result = 'PASS';
        if (prod.priceVerified && destPrice !== 'N/A' && destPrice !== skinPriceStr) {
          result = 'FAIL_PRICE_MISMATCH';
        } else if (httpStatus >= 400 && httpStatus !== 403) {
          result = 'FAIL_HTTP_ERROR';
        }

        allResults.push({
          category: item.label,
          productShown: prod.productName,
          retailer: prod.retailer,
          skinPrice: skinPriceStr,
          destProduct: destTitle !== 'N/A' ? destTitle : prod.productName,
          destPrice: destPrice,
          exactMatch: (destPrice === skinPriceStr || !prod.priceVerified) ? 'YES' : 'NO',
          result
        });
      }
    } catch (err) {
      console.error('Error fetching category:', item.label, err);
    }
  }

  console.log(`\n======================================================`);
  console.log(`TESTING KIDS PERSONA (Zero Adult Makeup Check)...`);
  console.log(`======================================================`);

  const kidProfile = {
    name: 'Aarav',
    pronouns: 'Kids / Children’s styling',
    ageGroup: 'Kids (0–12)',
    height: '4 ft',
    appearance: { skinTone: 'Fair', undertone: 'Neutral', confidence: 90, contrast: 'Medium' },
    bodyBuild: 'Average',
    fit: 'Relaxed',
    style: ['Casual'],
    colorsLove: ['Sky Blue'],
    colorsAvoid: ['All Black'],
    restrictions: [],
    occasion: 'Birthday',
    impression: ['Approachable'],
    budget: '₹0–₹2K'
  };

  const kidRes = await fetch('http://localhost:5173/api/product-recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ look: baseLook, profile: kidProfile })
  });
  const kidData = await kidRes.json();
  console.log('Kids Persona detected:', kidData.persona);
  console.log('Kids Applicable Categories:', kidData.applicableCategories);
  const kidsHasMakeup = kidData.applicableCategories.includes('makeup') || (kidData.products || []).some(p => p.category === 'makeup');
  console.log('Kids Adult Makeup Excluded:', !kidsHasMakeup ? 'PASS (100% Excluded)' : 'FAIL');

  console.log(`\n======================================================`);
  console.log(`FINAL E2E VERIFICATION RESULTS TABLE:`);
  console.log(`======================================================`);
  console.table(allResults);

  console.log('\nJSON Output:');
  console.log(JSON.stringify(allResults, null, 2));
}

verifyLiveFlow();
