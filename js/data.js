/* Demo marketplace data: all creators, brands and metrics are fictional sample data.
   Photos: Unsplash, avatars: randomuser.me, featured portraits: AI-generated (assets/img) */
const DATA = (() => {
  const U = (id, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;
  const avatar = (g, n) => `https://randomuser.me/api/portraits/${g}/${n}.jpg`;

  const CATEGORIES = [
    { id: 'fashion', name: 'Fashion', icon: 'shirt', img: '1515886657613-9f3515b0c78f', pool: ['1515886657613-9f3515b0c78f', '1483985988355-763728e1935b', '1490481651871-ab68de25d43d', '1509631179647-0177331693ae', '1529139574466-a303027c1d8b'] },
    { id: 'tech', name: 'Tech', icon: 'cpu', img: '1498050108023-c5249f4df085', pool: ['1498050108023-c5249f4df085', '1518770660439-4636190af475', '1519389950473-47ba0277781c', '1526738549149-8e07eca6c147', '1517694712202-14dd9538aa97'] },
    { id: 'food', name: 'Food', icon: 'utensils', img: '1504674900247-0877df9cc836', pool: ['1504674900247-0877df9cc836', '1546069901-ba9599a7e63c', '1565299624946-b28f40a0ae38', '1540189549336-e6e99c3679fe', '1512621776951-a57141f2eefd', '1495474472287-4d71bcdd2085'] },
    { id: 'fitness', name: 'Fitness', icon: 'dumbbell', img: '1571019613454-1cb2f99b2d8b', pool: ['1571019613454-1cb2f99b2d8b', '1517836357463-d25dfeac3438', '1534438327276-14e5300c3a48', '1518611012118-696072aa579a', '1544367567-0f2fcb009e0b'] },
    { id: 'travel', name: 'Travel', icon: 'plane', img: '1507525428034-b723cf961d3e', pool: ['1507525428034-b723cf961d3e', '1469854523086-cc02fe5d8800', '1476514525535-07fb3b4ae5f1', '1488646953014-85cb44e25828', '1501785888041-af3ef285b470', '1506905925346-21bda4d32df4'] },
    { id: 'beauty', name: 'Beauty', icon: 'sparkles', img: '1522335789203-aabd1fc54bc9', pool: ['1522335789203-aabd1fc54bc9', '1596462502278-27bfdc403348', '1487412947147-5cebf100ffc2', '1512496015851-a90fb38ba796'] },
    { id: 'gaming', name: 'Gaming', icon: 'gamepad-2', img: '1542751371-adc38448a05e', pool: ['1542751371-adc38448a05e', '1538481199705-c710c4e965fc', '1511512578047-dfb367046420', '1493711662062-fa541adb3fc8', '1550745165-9bc0b252726f'] },
    { id: 'education', name: 'Education', icon: 'graduation-cap', img: '1503676260728-1c00da094a0b', pool: ['1503676260728-1c00da094a0b', '1434030216411-0b793f4b4173', '1456513080510-7bf3a84b82f8', '1513258496099-48168024aec0'] },
    { id: 'music', name: 'Music', icon: 'music', img: '1511379938547-c1f69419868d', pool: ['1511379938547-c1f69419868d', '1493225457124-a3eb161ffa5f', '1516035069371-29a1b244cc32'] },
    { id: 'photography', name: 'Photography', icon: 'camera', img: '1452587925148-ce544e77e70d', pool: ['1452587925148-ce544e77e70d', '1516035069371-29a1b244cc32', '1492691527719-9d1e07e534b4', '1476514525535-07fb3b4ae5f1'] },
    { id: 'comedy', name: 'Comedy', icon: 'laugh', img: '1527224857830-43a7acc85260', pool: ['1527224857830-43a7acc85260', '1516280440614-37939bbacd81', '1585699324551-f6c309eedeca', '1543584756-8f40a802e14f', '1603190287605-e6ade32fa852'] },
    { id: 'art', name: 'Art & Design', icon: 'palette', img: '1513364776144-60967b0f800f', pool: ['1513364776144-60967b0f800f', '1460661419201-fd4cecdf8a8b', '1541961017774-22349e4a1262', '1579783902614-a3fb3927b6a5', '1547891654-e66ed7ebb968'] },
    { id: 'finance', name: 'Finance', icon: 'briefcase', img: '1554224155-6726b3ff858f', pool: ['1554224155-6726b3ff858f', '1611974789855-9c2a0a7236a3', '1579621970563-ebec7560ff3e', '1460925895917-afdab827c52f'] },
    { id: 'home', name: 'Home & DIY', icon: 'sofa', img: '1586023492125-27b2c045efd7', pool: ['1586023492125-27b2c045efd7', '1616486338812-3dadae4b4ace', '1556228453-efd6c1ff04f6', '1484101403633-562f891dc89a', '1493663284031-b7e3aefcae8e'] },
    { id: 'parenting', name: 'Parenting', icon: 'baby', img: '1476703993599-0035a21b17a9', pool: ['1476703993599-0035a21b17a9', '1511895426328-dc8714191300', '1503454537195-1dcabb73ffb9', '1491013516836-7db643ee125a', '1536640712-4d4c36ff0e4e'] },
  ];
  const catById = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  const PLATFORM_META = {
    instagram: { name: 'Instagram', icon: 'instagram', color: '#dd2a7b' },
    youtube: { name: 'YouTube', icon: 'youtube', color: '#ff0033' },
    x: { name: 'X', icon: 'twitter', color: '#64748b' },
    linkedin: { name: 'LinkedIn', icon: 'linkedin', color: '#0a66c2' },
    twitch: { name: 'Twitch', icon: 'twitch', color: '#9146ff' },
  };

  // [id, name, handle, gender, avatarNo, category, city, platforms, engagement, rating, reviews, basePrice, bio, tags, languages, badges]
  // badges: 'top' / 'rising' are marketplace labels, not identity verification
  const RAW = [
    ['aanya', 'Aaradhya Sharma', 'aaradhya.styles', 'women', 44, 'fashion', 'Mumbai', { instagram: 1080000, youtube: 120000 }, 4.8, 4.9, 212, 18000,
      'Street-style, festive lookbooks and everyday fashion. I help D2C fashion labels launch collections with reels that actually convert.', ['Lookbooks', 'Reels', 'Sustainable', 'Festive'], ['English', 'Hindi'], ['top']],
    ['rohan', 'Rohan Verma', 'rohanverma.tech', 'men', 32, 'tech', 'Bengaluru', { youtube: 610000, instagram: 200000, x: 45000 }, 6.2, 4.8, 340, 25000,
      'Honest gadget reviews and unboxings. Subscribers trust my "buy or skip" verdicts on phones, laptops and smart home gear.', ['Unboxing', 'Reviews', 'Smartphones', 'Laptops'], ['English', 'Hindi', 'Kannada'], ['top']],
    ['priya', 'Priya Nair', 'priyamoves', 'women', 68, 'fitness', 'Kochi', { instagram: 1900000, youtube: 500000 }, 7.3, 4.9, 156, 22000,
      'Strength training and mobility for busy people. Follow-along workouts, habit challenges and honest activewear reviews.', ['Workouts', 'Mobility', 'Challenges', 'Wellness'], ['English', 'Malayalam', 'Tamil'], ['top']],
    ['kabir', 'Kabir Singh', 'kabirlifts', 'men', 75, 'fitness', 'Delhi', { instagram: 395000, youtube: 210000 }, 6.3, 4.7, 289, 15000,
      'Strength coach. Workout programs, supplement reviews and transformation stories.', ['Strength', 'Nutrition', 'Transformations'], ['English', 'Hindi', 'Punjabi'], ['top']],
    ['meera', 'Meera Iyer', 'meeraglows', 'women', 65, 'beauty', 'Chennai', { instagram: 520000, youtube: 140000 }, 5.2, 4.9, 401, 20000,
      'Skincare for Indian skin. Ingredient breakdowns, GRWM and honest product tests.', ['Skincare', 'GRWM', 'Makeup'], ['English', 'Tamil'], ['top']],
    ['arjun', 'Arjun Mehta', 'arjuncooks', 'men', 46, 'food', 'Hyderabad', { instagram: 704000, youtube: 230000 }, 5.1, 4.8, 178, 12000,
      'Hyderabadi home-cooking, biryani deep-dives and quick weeknight recipes. Recipe reels, product integrations and festive specials.', ['Recipes', 'Reels', 'Biryani', 'Festive'], ['English', 'Telugu', 'Hindi'], []],
    ['sara', 'Sara Khan', 'learnwithsara', 'women', 24, 'education', 'Pune', { youtube: 830000, instagram: 96000 }, 6.0, 4.9, 264, 30000,
      'Making coding & careers simple. Ed-tech partnerships, course launches and explainer videos.', ['Coding', 'Careers', 'Explainers'], ['English', 'Hindi'], ['top']],
    ['kavya', 'Kavya Reddy', 'kavyaplays', 'women', 22, 'gaming', 'Hyderabad', { youtube: 1200000, twitch: 250000, instagram: 150000 }, 8.9, 4.7, 198, 35000,
      'Daily gaming streams and esports commentary in Telugu and English. Game launches, peripherals and energy-drink collabs.', ['Streams', 'Esports', 'Peripherals'], ['English', 'Telugu', 'Hindi'], ['rising']],
    ['ishita', 'Ishita Bose', 'ishitaframes', 'women', 12, 'photography', 'Kolkata', { instagram: 145000 }, 6.7, 4.8, 92, 9000,
      'Product and editorial photographer. I create scroll-stopping brand visuals and UGC content.', ['Product shoots', 'UGC', 'Editorial'], ['English', 'Bengali'], []],
    ['vikram', 'Vikram Rao', 'vikrambeats', 'men', 52, 'music', 'Bengaluru', { youtube: 420000, instagram: 150000 }, 5.9, 4.8, 120, 22000,
      'Indie musician and producer. Custom jingles, music-led reels and audio product reviews.', ['Jingles', 'Covers', 'Audio gear'], ['English', 'Kannada'], []],
    ['ananya', 'Ananya Gupta', 'yogawithananya', 'women', 33, 'fitness', 'Rishikesh', { instagram: 98000 }, 8.4, 5.0, 64, 4000,
      'Yoga and mindful living. Small but super-engaged community of wellness seekers.', ['Yoga', 'Wellness', 'Mindfulness'], ['English', 'Hindi'], ['rising']],
    ['neel', 'Neel Kapoor', 'neeleats', 'men', 11, 'food', 'Mumbai', { youtube: 230000, instagram: 160000 }, 6.1, 4.7, 143, 12000,
      'Street-food explorer. Restaurant launches, food delivery apps and taste tests.', ['Street food', 'Reviews', 'Restaurants'], ['English', 'Hindi', 'Marathi'], []],
    ['zara', 'Zara Ali', 'zarawears', 'women', 90, 'fashion', 'Hyderabad', { instagram: 67000 }, 9.1, 4.9, 38, 3500,
      'Modest fashion and thrift flips. Rising creator with one of the highest engagement rates in the niche.', ['Modest fashion', 'Thrift', 'Reels'], ['English', 'Urdu', 'Telugu'], ['rising']],
    ['aditya', 'Aditya Verma', 'adityabuilds', 'men', 85, 'tech', 'Gurugram', { linkedin: 85000, x: 60000 }, 4.8, 4.8, 77, 14000,
      'SaaS founder writing about startups, AI and productivity. Ideal for B2B product launches.', ['B2B', 'SaaS', 'AI', 'Threads'], ['English', 'Hindi'], []],
    ['sneha', 'Sneha Patel', 'snehawanders', 'women', 57, 'travel', 'Ahmedabad', { instagram: 2100000, youtube: 300000 }, 5.7, 4.8, 110, 16000,
      'Slow travel, mountain treks and boutique stays. Cinematic reels with strong booking intent.', ['Treks', 'Boutique stays', 'Reels', 'Vlogs'], ['English', 'Gujarati', 'Hindi'], []],
    ['riya', 'Riya Malhotra', 'riyamakeup', 'women', 79, 'beauty', 'Delhi', { instagram: 41000 }, 9.6, 5.0, 26, 2500,
      'Affordable makeup looks and drugstore dupes. Nano creator with a loyal Gen-Z audience.', ['Makeup', 'Dupes', 'Gen-Z'], ['English', 'Hindi'], ['rising']],
    // More fictional sample creators across 15 niches (appended so existing creators keep their photos and details)
    ['tanvi', 'Tanvi Desai', 'tanvi.wears', 'women', 5, 'fashion', 'Jaipur', { instagram: 452000, youtube: 38000 }, 6.4, 4.8, 97, 9500,
      'Handloom, block prints and everyday ethnic styling. Lookbooks and try-on reels for homegrown fashion labels.', ['Ethnic wear', 'Handloom', 'Try-ons', 'Reels'], ['English', 'Hindi'], []],
    ['rahul', 'Rahul Khanna', 'rahulkhanna.fits', 'men', 14, 'fashion', 'Delhi', { instagram: 286000, youtube: 64000 }, 5.6, 4.7, 81, 8000,
      'Menswear, grooming basics and capsule wardrobes on a budget. Outfit formulas that guys actually wear.', ['Menswear', 'Grooming', 'Capsule wardrobe'], ['English', 'Hindi', 'Punjabi'], []],
    ['pooja', 'Pooja Menon', 'poojaskin', 'women', 15, 'beauty', 'Bengaluru', { instagram: 612000, youtube: 205000 }, 5.8, 4.9, 233, 19000,
      'Skincare routines, sunscreen tests and ingredient explainers for humid Indian weather.', ['Skincare', 'Sunscreen', 'Ingredients'], ['English', 'Malayalam', 'Kannada'], ['top']],
    ['aisha', 'Aisha Siddiqui', 'aisha.glam', 'women', 26, 'beauty', 'Lucknow', { instagram: 73000 }, 8.8, 4.9, 31, 3000,
      'Bridal and festive makeup looks with affordable products. Step-by-step tutorials for beginners.', ['Bridal makeup', 'Tutorials', 'Festive'], ['English', 'Hindi', 'Urdu'], ['rising']],
    ['siddharth', 'Siddharth Joshi', 'sidtechtalks', 'men', 18, 'tech', 'Pune', { youtube: 740000, instagram: 120000, x: 52000 }, 5.9, 4.8, 214, 24000,
      'Laptop and smartphone comparisons, camera tests and "is it worth it" verdicts for Indian buyers.', ['Comparisons', 'Smartphones', 'Laptops', 'Cameras'], ['English', 'Hindi', 'Marathi'], ['top']],
    ['nisha', 'Nisha Agarwal', 'nishacodes.ai', 'women', 31, 'tech', 'Noida', { linkedin: 64000, x: 41000, instagram: 52000 }, 6.8, 4.9, 48, 9000,
      'AI tools, productivity apps and no-code workflows explained in under a minute.', ['AI tools', 'Productivity', 'No-code'], ['English', 'Hindi'], ['rising']],
    ['dev', 'Dev Malhotra', 'devonthemove', 'men', 27, 'travel', 'Manali', { instagram: 880000, youtube: 310000 }, 6.0, 4.8, 126, 17000,
      'Himalayan road trips, bike expeditions and offbeat homestays. Cinematic reels with practical itineraries.', ['Road trips', 'Himalayas', 'Homestays', 'Vlogs'], ['English', 'Hindi'], []],
    ['lakshmi', 'Lakshmi Krishnan', 'lakshmitravels', 'women', 36, 'travel', 'Kochi', { instagram: 164000, youtube: 42000 }, 7.4, 4.9, 58, 7000,
      'Budget solo travel across South India for women. Safety tips, train journeys and temple towns.', ['Solo travel', 'Budget', 'South India'], ['English', 'Malayalam', 'Tamil'], ['rising']],
    ['farhan', 'Farhan Qureshi', 'farhanfeasts', 'men', 29, 'food', 'Lucknow', { youtube: 520000, instagram: 340000 }, 6.6, 4.8, 167, 14000,
      'Awadhi kebabs, slow-cooked curries and old-city food walks. Recipe videos and restaurant collabs.', ['Awadhi', 'Kebabs', 'Food walks', 'Recipes'], ['English', 'Hindi', 'Urdu'], ['top']],
    ['divya', 'Divya Shetty', 'divyaskitchen', 'women', 40, 'food', 'Mangaluru', { instagram: 118000 }, 7.9, 4.9, 44, 5000,
      'Coastal Karnataka home recipes, healthy tiffin ideas and millet bakes in 30-second reels.', ['Coastal recipes', 'Tiffin', 'Millets'], ['English', 'Kannada'], ['rising']],
    ['varun', 'Varun Chauhan', 'varunfitlife', 'men', 36, 'fitness', 'Chandigarh', { instagram: 540000, youtube: 190000 }, 5.4, 4.7, 138, 13000,
      'Fat-loss programs, home workouts and protein-on-a-budget meal prep.', ['Fat loss', 'Home workouts', 'Meal prep'], ['English', 'Hindi', 'Punjabi'], []],
    ['meghna', 'Meghna Das', 'meghnaruns', 'women', 47, 'fitness', 'Guwahati', { instagram: 89000, youtube: 21000 }, 8.1, 4.9, 29, 3500,
      'Marathon training, running-shoe reviews and beginner 5K plans.', ['Running', 'Marathon', 'Shoe reviews'], ['English', 'Hindi', 'Bengali'], ['rising']],
    ['amit', 'Amit Tiwari', 'amitsirexplains', 'men', 40, 'education', 'Varanasi', { youtube: 1500000, instagram: 220000 }, 7.1, 4.9, 302, 28000,
      'Exam prep and science explainers for school students. Simple Hindi lessons watched by millions.', ['Exam prep', 'Science', 'Explainers'], ['Hindi', 'English'], ['top']],
    ['shreya', 'Shreya Kulkarni', 'shreyalearns', 'women', 50, 'education', 'Pune', { instagram: 176000, linkedin: 38000 }, 6.3, 4.8, 62, 8000,
      'Study techniques, spoken-English practice and career guidance for college students.', ['Study tips', 'Spoken English', 'Careers'], ['English', 'Marathi', 'Hindi'], []],
    ['aryan', 'Aryan Shah', 'aryanclutch', 'men', 42, 'gaming', 'Ahmedabad', { youtube: 690000, twitch: 120000, instagram: 84000 }, 8.2, 4.7, 111, 26000,
      'Battle-royale highlights, clutch moments and mobile esports tournament coverage.', ['Battle royale', 'Mobile esports', 'Highlights'], ['English', 'Hindi', 'Gujarati'], []],
    ['tara', 'Tara Fernandes', 'taraplaysgg', 'women', 53, 'gaming', 'Goa', { twitch: 96000, youtube: 58000 }, 9.0, 4.9, 27, 6000,
      'Cozy and indie game streams with a friendly community. A great fit for PC peripherals and indie launches.', ['Indie games', 'Streams', 'PC gaming'], ['English'], ['rising']],
    ['karan', 'Karan Bedi', 'karanbedi.lens', 'men', 48, 'photography', 'Amritsar', { instagram: 310000, youtube: 47000 }, 6.2, 4.8, 88, 11000,
      'Street and wedding photographer. Lens reviews, editing tutorials and brand campaigns shot on location.', ['Street photography', 'Weddings', 'Editing'], ['English', 'Hindi', 'Punjabi'], []],
    ['nandini', 'Nandini Rao', 'nandinifilms', 'women', 60, 'photography', 'Mysuru', { instagram: 58000, youtube: 16000 }, 8.6, 4.9, 22, 4500,
      'Videographer making short brand films, product B-roll and UGC ads.', ['Videography', 'Brand films', 'UGC'], ['English', 'Kannada'], ['rising']],
    ['bunty', 'Bunty Saxena', 'buntyskits', 'men', 55, 'comedy', 'Indore', { instagram: 1400000, youtube: 450000 }, 7.8, 4.8, 154, 21000,
      'Comedy & entertainment: relatable family skits and office humour, with brand integrations written into the story.', ['Comedy', 'Skits', 'Entertainment', 'Reels'], ['Hindi', 'English'], ['top']],
    ['ritika', 'Ritika Jain', 'ritikalol', 'women', 62, 'comedy', 'Jaipur', { instagram: 96000, youtube: 24000 }, 9.2, 4.9, 19, 4000,
      'Comedy & entertainment: stand-up clips, parody songs and Gen-Z humour.', ['Comedy', 'Stand-up', 'Parody'], ['Hindi', 'English'], ['rising']],
    ['ira', 'Ira Banerjee', 'ira.draws', 'women', 71, 'art', 'Kolkata', { instagram: 204000 }, 7.2, 4.9, 46, 7500,
      'Art & design: illustrator and digital artist. Custom artwork, packaging illustrations and process reels.', ['Art', 'Illustration', 'Design', 'Packaging'], ['English', 'Bengali'], []],
    ['manav', 'Manav Pillai', 'manavdesigns', 'men', 61, 'art', 'Thiruvananthapuram', { instagram: 47000, linkedin: 22000 }, 8.0, 4.8, 18, 4000,
      'Art & design: graphic designer sharing branding, typography and logo design breakdowns.', ['Design', 'Branding', 'Typography'], ['English', 'Malayalam'], ['rising']],
    ['harsh', 'Harsh Vardhan', 'harshonmoney', 'men', 64, 'finance', 'Mumbai', { youtube: 960000, instagram: 310000, x: 88000 }, 5.5, 4.8, 187, 27000,
      'Finance & business: budgeting basics and how businesses make money, explained simply. Educational content, not investment advice.', ['Finance', 'Business', 'Budgeting', 'Explainers'], ['English', 'Hindi'], ['top']],
    ['anjali', 'Anjali Mehra', 'anjalibuilds.biz', 'women', 74, 'finance', 'Bengaluru', { linkedin: 120000, instagram: 68000 }, 6.1, 4.9, 39, 10000,
      'Finance & business: small-business growth, founder stories and marketing lessons for D2C brands.', ['Business', 'Startups', 'Marketing'], ['English', 'Hindi'], []],
    ['rhea', "Rhea D'Souza", 'rheadances', 'women', 82, 'music', 'Mumbai', { instagram: 930000, youtube: 260000 }, 7.0, 4.8, 140, 18000,
      'Music & dance: choreography reels, dance challenges and Bollywood covers. A natural fit for song launches.', ['Dance', 'Choreography', 'Bollywood', 'Reels'], ['English', 'Hindi', 'Marathi'], ['top']],
    ['gautam', 'Gautam Sethi', 'gautamstrings', 'men', 67, 'music', 'Delhi', { youtube: 210000, instagram: 95000 }, 6.4, 4.8, 57, 9000,
      'Music & dance: acoustic guitar covers, music lessons and instrument reviews.', ['Guitar', 'Covers', 'Lessons'], ['English', 'Hindi'], []],
    ['simran', 'Simran Kaur', 'simranshome', 'women', 86, 'home', 'Ludhiana', { instagram: 388000, youtube: 72000 }, 6.9, 4.9, 84, 10000,
      'Home decor & DIY: small-space makeovers, rental-friendly decor and festive home styling.', ['Home decor', 'DIY', 'Makeovers'], ['English', 'Hindi', 'Punjabi'], []],
    ['rohit', 'Rohit Bansal', 'rohitmakesit', 'men', 71, 'home', 'Surat', { youtube: 150000, instagram: 61000 }, 7.6, 4.8, 26, 5500,
      'Home decor & DIY: woodworking, budget furniture builds and weekend DIY projects.', ['DIY', 'Woodworking', 'Furniture'], ['English', 'Hindi', 'Gujarati'], ['rising']],
    ['kavita', 'Kavita Joshi', 'kavitaparents', 'women', 88, 'parenting', 'Dehradun', { instagram: 470000, youtube: 95000 }, 6.7, 4.9, 102, 11000,
      'Parenting & family: toddler routines, kids activities and honest baby-product reviews.', ['Parenting', 'Family', 'Kids activities'], ['English', 'Hindi'], []],
    ['sameer', 'Sameer Ali', 'dadwithsameer', 'men', 78, 'parenting', 'Hyderabad', { instagram: 84000 }, 8.7, 4.9, 21, 4000,
      'Parenting & family: a dad sharing family vlogs, weekend activities and work-life balance tips.', ['Parenting', 'Family vlogs', 'Dad life'], ['English', 'Hindi', 'Telugu', 'Urdu'], ['rising']],
  ];

  // The six creators featured on the landing page, with locally stored AI-generated portraits
  const FEATURED = [
    { id: 'aanya', img: 'assets/img/card-fashion.jpg', label: 'Top Creator', icon: 'star', tone: 'orange' },
    { id: 'rohan', img: 'assets/img/card-tech.jpg', label: 'Rising Star', icon: 'sparkles', tone: 'blue' },
    { id: 'sneha', img: 'assets/img/card-travel.jpg', label: "Editor's Pick", icon: 'badge-check', tone: 'teal' },
    { id: 'priya', img: 'assets/img/card-fitness.jpg', label: 'Popular', icon: 'heart', tone: 'pink' },
    { id: 'arjun', img: 'assets/img/card-food.jpg', label: 'Trending', icon: 'flame', tone: 'orange' },
    { id: 'kavya', img: 'assets/img/card-gaming.jpg', label: 'Gaming Creator', icon: 'gamepad-2', tone: 'violet' },
  ];
  const featuredById = Object.fromEntries(FEATURED.map(f => [f.id, f]));

  const LANGUAGES = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Bengali', 'Punjabi', 'Urdu'];
  // Budget brackets are per-creator starting prices in INR
  const BUDGETS = [
    { id: 'any', name: 'Any Budget', min: 0, max: Infinity },
    { id: 'u5', name: 'Under ₹5,000', min: 0, max: 5000 },
    { id: '5-15', name: '₹5,000 – ₹15,000', min: 5000, max: 15000 },
    { id: '15-30', name: '₹15,000 – ₹30,000', min: 15000, max: 30000 },
    { id: '30+', name: '₹30,000+', min: 30000, max: Infinity },
  ];

  const roundPrice = n => Math.round(n / 500) * 500;
  function packages(base, main) {
    const isVideo = main === 'youtube' || main === 'twitch';
    const isText = main === 'linkedin' || main === 'x';
    return [
      { tier: 'Basic', price: base, days: 3, revisions: '1 revision', rights: 'Organic posting only', title: isText ? '1 sponsored post' : isVideo ? '60-sec dedicated Short' : '1 Reel or post',
        items: [isText ? '1 sponsored post' : isVideo ? '1 YouTube Short' : '1 Instagram Reel / post', 'Brand tag + link in bio', '1 revision'] },
      { tier: 'Standard', price: roundPrice(base * 2.2), days: 5, popular: true, revisions: '2 revisions', rights: '30-day usage rights', title: isText ? 'Post + thread series' : isVideo ? '90-sec integration' : 'Reel + 3 stories',
        items: [isText ? '1 post + 3-part thread' : isVideo ? '60–90 sec in-video integration' : '1 Reel + 3 Stories with link', 'Script shared for approval', '30-day usage rights', '2 revisions'] },
      { tier: 'Premium', price: roundPrice(base * 4.5), days: 10, revisions: 'Unlimited revisions', rights: '90-day usage rights + ads whitelisting', title: isText ? 'Launch campaign' : isVideo ? 'Dedicated video' : 'Full campaign',
        items: [isText ? '3 posts + newsletter mention' : isVideo ? 'Dedicated 8–10 min video' : '2 Reels + 6 Stories + 1 post', 'Raw footage included', '90-day usage rights + ads whitelisting', 'Performance report', 'Unlimited revisions'] },
    ];
  }

  const REVIEWERS = ['Sunrise Bakery', 'Nimbus Audio', 'Kora Skincare', 'Trailblaze Gear', 'ByteNest', 'Masala Box', 'UrbanThread', 'Zenfit App', 'PixelPlay Studios', 'Lumen Edu', 'Oceanic Stays', 'Brewhaus Coffee'];
  const REVIEW_TEXT = [
    'Delivered ahead of schedule and the reel crossed 1M views. Our best-performing creator collab this quarter.',
    'Super professional — shared a script within a day and nailed our brand tone on the first try.',
    'Great storytelling. We saw a clear spike in website traffic and promo-code redemptions.',
    'Communication was smooth and the content quality felt premium. Will definitely book again.',
    'Authentic content that felt native to their audience. Comments were full of purchase intent.',
    'Very responsive and open to feedback. The raw footage was a big bonus for our ads team.',
  ];

  const CREATORS = RAW.map(([id, name, handle, g, n, category, city, platforms, engagement, rating, reviews, base, bio, tags, languages, badges], i) => {
    const pool = catById[category].pool;
    const main = Object.entries(platforms).sort((a, b) => b[1] - a[1])[0][0];
    const followers = Object.values(platforms).reduce((a, b) => a + b, 0);
    const feat = featuredById[id];
    return {
      id, name, handle, category, city, platforms, engagement, rating, reviews, bio, tags, languages, badges, main, followers,
      avatar: feat ? feat.img : avatar(g, n),
      cover: U(pool[i % pool.length], 1400),
      thumb: feat ? feat.img : U(pool[i % pool.length], 700),
      portfolio: Array.from({ length: 6 }, (_, k) => {
        const pid = pool[(i + k) % pool.length];
        return { img: U(pid, 900), views: Math.round((followers * (0.4 + ((i * 7 + k * 13) % 10) / 6)) / 1000) * 1000, type: k % 3 === 0 ? 'Reel' : k % 3 === 1 ? 'Post' : 'Video' };
      }),
      packages: packages(base, main),
      priceFrom: base,
      responseHrs: [1, 2, 3, 6, 12][i % 5],
      completed: Math.round(reviews * 1.3),
      reviewList: Array.from({ length: 4 }, (_, k) => ({
        brand: REVIEWERS[(i * 3 + k) % REVIEWERS.length],
        stars: k === 3 && rating < 4.9 ? 4 : 5,
        text: REVIEW_TEXT[(i + k) % REVIEW_TEXT.length],
        ago: ['2 weeks ago', '1 month ago', '2 months ago', '3 months ago'][k],
      })),
    };
  });

  const CAMPAIGNS = [
    { id: 'c1', brand: 'Kora Skincare', color: 'linear-gradient(135deg,#f472b6,#fb923c)', title: 'Monsoon skincare routine launch', category: 'beauty', budget: [15000, 40000], platforms: ['instagram'], deadline: 'Oct 28', applicants: 34, cover: '1596462502278-27bfdc403348',
      brief: 'We are launching a lightweight gel moisturiser for humid weather. Looking for beauty creators to make an honest "monsoon routine" Reel featuring the product.', deliverables: ['1 Reel (30–60s)', '3 Stories with swipe-up', 'Usage rights 30 days'] },
    { id: 'c2', brand: 'ByteNest', color: 'linear-gradient(135deg,#6366f1,#22d3ee)', title: 'AI note-taking app for students', category: 'education', budget: [25000, 80000], platforms: ['youtube', 'instagram'], deadline: 'Nov 5', applicants: 21, cover: '1434030216411-0b793f4b4173',
      brief: 'ByteNest turns lectures into smart notes. We want study / productivity creators to show how they use it during exam season.', deliverables: ['60–90s YouTube integration', '1 Reel', 'Promo code tracking'] },
    { id: 'c3', brand: 'Trailblaze Gear', color: 'linear-gradient(135deg,#16a34a,#a3e635)', title: 'Himalayan trek gear review', category: 'travel', budget: [30000, 90000], platforms: ['youtube', 'instagram'], deadline: 'Nov 12', applicants: 12, cover: '1506905925346-21bda4d32df4',
      brief: 'Take our new waterproof backpack and jacket on a real trek. Cinematic content preferred; travel costs covered.', deliverables: ['1 vlog integration', '2 Reels', 'Raw footage'] },
    { id: 'c4', brand: 'Masala Box', color: 'linear-gradient(135deg,#ea580c,#facc15)', title: 'Festive recipe series with our spice kits', category: 'food', budget: [8000, 25000], platforms: ['instagram'], deadline: 'Oct 30', applicants: 47, cover: '1546069901-ba9599a7e63c',
      brief: 'Create 2 Diwali recipes using Masala Box spice kits. Warm, homely and festive vibes.', deliverables: ['2 recipe Reels', 'Story with discount code'] },
    { id: 'c5', brand: 'PixelPlay Studios', color: 'linear-gradient(135deg,#7c3aed,#ec4899)', title: 'Mobile game launch: Sky Raiders', category: 'gaming', budget: [40000, 150000], platforms: ['youtube', 'twitch'], deadline: 'Nov 20', applicants: 18, cover: '1542751371-adc38448a05e',
      brief: 'Stream or record first-impressions gameplay of Sky Raiders at launch. Download link tracked via unique codes.', deliverables: ['1 live stream (60 min)', '1 YouTube video', 'Pinned comment link'] },
    { id: 'c6', brand: 'Zenfit App', color: 'linear-gradient(135deg,#0ea5e9,#22c55e)', title: '30-day home workout challenge', category: 'fitness', budget: [12000, 50000], platforms: ['instagram', 'youtube'], deadline: 'Nov 1', applicants: 29, cover: '1518611012118-696072aa579a',
      brief: 'Kick off a 30-day challenge with your community using the Zenfit app. Weekly check-ins encouraged.', deliverables: ['Kick-off Reel', '4 weekly Stories', 'Final results post'] },
    { id: 'c7', brand: 'UrbanThread', color: 'linear-gradient(135deg,#111827,#6b7280)', title: 'Winter streetwear drop', category: 'fashion', budget: [10000, 35000], platforms: ['instagram'], deadline: 'Nov 8', applicants: 52, cover: '1490481651871-ab68de25d43d',
      brief: 'Style 3 looks from our winter streetwear drop. Outfit transitions and lookbook-style Reels welcome.', deliverables: ['1 transition Reel', '1 carousel post'] },
    { id: 'c8', brand: 'Nimbus Audio', color: 'linear-gradient(135deg,#0f172a,#38bdf8)', title: 'Wireless earbuds honest review', category: 'tech', budget: [20000, 60000], platforms: ['youtube', 'x'], deadline: 'Nov 15', applicants: 15, cover: '1526738549149-8e07eca6c147',
      brief: 'We want honest long-form reviews of our new ANC earbuds. Tech and music creators both welcome.', deliverables: ['Dedicated review or integration', 'X thread with specs'] },
  ].map((c, i) => ({ ...c, cover: U(c.cover, 900), status: i === 6 ? 'In review' : i === 3 ? 'Closing soon' : 'Open' }));

  const SEED_THREADS = [
    { creatorId: 'priya', messages: [
      { from: 'me', text: 'Hi Priya! Loved your 30-day mobility challenge. Would you be open to a collab with our activewear brand?', t: Date.now() - 86400000 * 2 },
      { from: 'them', text: 'Hi! Thank you so much 😊 Yes, I would love to! Could you share the product details and timeline?', t: Date.now() - 86400000 * 2 + 3600000 },
    ] },
    { creatorId: 'rohan', messages: [
      { from: 'me', text: 'Hey Rohan, are you taking integrations for November?', t: Date.now() - 86400000 },
      { from: 'them', text: 'Hey! I have 2 slots left in the 2nd half of November. The Standard package works best for launches.', t: Date.now() - 86400000 + 7200000 },
    ] },
  ];

  const NICHE_LABEL = {
    fashion: 'Fashion & Lifestyle', tech: 'Tech & Gadgets', food: 'Food & Cooking', fitness: 'Fitness & Wellness', travel: 'Travel & Adventure',
    beauty: 'Beauty & Skincare', gaming: 'Gaming & Esports', education: 'Education & Careers', music: 'Music & Audio', photography: 'Photography & UGC',
    comedy: 'Comedy & Entertainment', art: 'Art & Design', finance: 'Finance & Business', home: 'Home Decor & DIY', parenting: 'Parenting & Family',
  };
  const FEATURE_LABEL = {
    profile_view: 'creator profile views', search: 'searches', ai_match: 'AI matching requests', campaign: 'campaigns', saved_creator: 'saved creators',
  };

  return { NICHE_LABEL, FEATURE_LABEL, CATEGORIES, catById, PLATFORM_META, CREATORS, CAMPAIGNS, SEED_THREADS, FEATURED, LANGUAGES, BUDGETS, U };
})();
