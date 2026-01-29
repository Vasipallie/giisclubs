//inits
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { time } from 'console';
import dotenv from 'dotenv';
import fs from 'fs';
import multer from 'multer';


dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cookieParser());
const supalink = process.env.SUPALINK ;
const supakey = process.env.SUPAKEY ;


// Supabase setup
//WARNING - DO NOT PUBLISH Api Keys VIA GITHUB OR ANY PUBLIC REPOSITORY
const supabase = createClient(supalink, supakey); 

// Middleware data stuff, important for app to run
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Multer configuration for image uploads
const logoDir = path.join(__dirname, 'views', 'logos');
const resourceDir = path.join(__dirname, 'views', 'resources');

// Ensure directories exist
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
if (!fs.existsSync(resourceDir)) fs.mkdirSync(resourceDir, { recursive: true });

const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'banner_upload') {
            return cb(null, resourceDir);
        }
        return cb(null, logoDir);
    },
    filename: (req, file, cb) => {
        // Get club name from req.clubName (set before multer)
        const clubName = (req.clubName || 'club').trim();
        const ext = path.extname(file.originalname).toLowerCase() || '.png';

        console.log('Multer filename generation - clubName:', req.clubName, 'using:', clubName);

        if (file.fieldname === 'banner_upload') {
            return cb(null, `${clubName}${ext}`);
        }

        if (file.fieldname === 'logo_p_upload') {
            return cb(null, `${clubName}${ext}`);
        }

        return cb(null, `${clubName}${ext}`);
    }
});

const uploadImages = multer({
    storage: imageStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image uploads are allowed.'));
        }
        cb(null, true);
    }
});

//routes
app.route('/').get(async (req, res) => {
    res.render('index');
});

app.route('/login').get(async (req, res) => {
    res.render('login');
})
app.post('/login', (req, res) => {
    const loginemail = req.body.loginemail;
    const loginpassword = req.body.loginpassword;

  supabase.auth.signInWithPassword({
    email: loginemail,
    password: loginpassword
  }).then(({ data, error }) => {
    if (error || !data?.session) {
      return res.render('login', { title: 'Login', error: 'Invalid credentials.' });
    }

    const token = data.session.access_token;
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 3 * 24 * 60 * 60 * 1000
    });
    res.redirect('/home');
  });
});
app.route('/home').get(async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.redirect('/login');
    }
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();

    res.render('chome', { user, clubName: club?.name || '' });
});

app.route('/explore').get(async (req, res) => {
    try {
        // Get all clubs from the database
        const { data: clubs, error } = await supabase
            .from('clubs')
            .select('*')
            .order('name', { ascending: true });
        
        if (error) {
            console.error('Error fetching clubs:', error);
            return res.render('explore', { clubs: [] });
        }
        
        res.render('explore', { clubs: clubs || [] });
    } catch (error) {
        console.error('Error in explore route:', error);
        res.render('explore', { clubs: [] });
    }
});

app.route('/shorten').get(async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.redirect('/login');
    }
    
    // Get user's club from clubs table
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.render('404');
    }
    
    // Get all links for this club
    const { data: links } = await supabase
        .from('shortcuts')
        .select('*')
        .eq('club', club.name);
    
    res.render('shorten', { user, club: club.name, links: links || [] });
});

app.route('/qrcode').get(async (req, res) => {
    res.render('qrgen');
});

app.route('/manage-club').get(async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.redirect('/login');
    }

    // Get user's club data directly
    const { data: club } = await supabase
        .from('clubs')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!club) {
        return res.render('manage-club', { error: 'Club not found', success: null, club: {} });
    }

    res.render('manage-club', { club: club || {}, success: req.query.success || null, error: null });
});

app.post('/manage-club', async (req, res, next) => {
    // First, authenticate and get club
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.redirect('/login');
    }

    // Get user's club BEFORE multer processes files
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();

    if (!club?.name) {
        return res.render('manage-club', { error: 'Club not found', club: {}, success: null });
    }

    // Store club name in req so multer can access it
    req.clubName = club.name;
    
    // Now process uploads with multer
    uploadImages.fields([{ name: 'banner_upload', maxCount: 1 }, { name: 'logo_p_upload', maxCount: 1 }])(req, res, async (err) => {
        if (err) {
            console.error('Multer error:', err.message);
            return res.render('manage-club', { error: `Upload error: ${err.message}`, club: {}, success: null });
        }
        
        // Continue with the rest of the route
        const { description, link_text, link } = req.body;

        try {
            const updateData = {
                description,
                link_text,
                link
            };

            // If logo was uploaded, save the file path
            if (req.files && req.files.logo_p_upload && req.files.logo_p_upload.length > 0) {
                const logoFile = req.files.logo_p_upload[0];
                const logoPath = `/logos/${logoFile.filename}`;
                updateData.logo = logoPath;
                console.log('Logo uploaded:', logoPath);
            }

            // If banner was uploaded, save the file path
            if (req.files && req.files.banner_upload && req.files.banner_upload.length > 0) {
                const bannerFile = req.files.banner_upload[0];
                const bannerPath = `/resources/${bannerFile.filename}`;
                updateData.banner = bannerPath;
                console.log('Banner uploaded:', bannerPath);
            }

            console.log('Updating club with data:', updateData);

            // Update clubs table by user ID
            const { error: updateError } = await supabase
                .from('clubs')
                .update(updateData)
                .eq('id', user.id);

            if (updateError) {
                console.error('Supabase update error:', updateError);
                return res.render('manage-club', { error: 'Failed to update club profile', club: club, success: null });
            }

            // Fetch updated club data
            const { data: updatedClub } = await supabase
                .from('clubs')
                .select('*')
                .eq('id', user.id)
                .single();

            res.render('manage-club', { club: updatedClub || club, success: 'Club profile updated successfully', error: null });
        } catch (err) {
            console.error('Error in /manage-club POST:', err);
            res.render('manage-club', { error: 'An error occurred while updating your profile', club: club, success: null });
        }
    });
});

app.post('/create', async (req, res) => {
    const token = req.cookies.token;
    // Get user's club
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();
    
    if (userError || !userData?.club) {
        userData.club = 'robotics';
    }
    
    const { link, customId } = req.body;
    
    // Generate random ID if no custom ID provided
    const id = customId || Math.random().toString(36).substring(2, 8);
     
    const { data: existing, error: existingError } = await supabase
        .from('shortcuts')
        .select('*')
        .eq('id', id)
        .single();
    if (existing) {
        return res.status(400).json({ error: 'Custom ID already in use. Please choose another one.' });
    }

    const { data, error: insertError } = await supabase
        .from('shortcuts')
        .insert([{ 
            id: id,
            link: link,
            club: userData.club || 'robotics'
        }])
        .select()
        .single();

    if (insertError) {
        return res.status(500).json({ error: 'Error creating shortcut: ' + insertError.message });
    }
    
    
    res.json({ success: true, data });
});

app.post('/idadd', async (req, res) => {
    
    const { link, customId } = req.body;
    
    // Generate random ID if no custom ID provided
    const id = customId || Math.random().toString(36).substring(2, 8);
     
    const { data: existing, error: existingError } = await supabase
        .from('shortcuts')
        .select('*')
        .eq('id', id)
        .single();
    if (existing) {
        return res.status(400).json({ error: 'Custom ID already in use. Please choose another one.' });
    }

    const { data, error: insertError } = await supabase
        .from('shortcuts')
        .insert([{ 
            id: id,
            link: link,
            club: 'robotics'
        }])
        .select()
        .single();

    if (insertError) {
        return res.status(500).json({ error: 'Error creating shortcut: ' + insertError.message });
    }
    
    
    res.json({ success: true, data });
});

app.put('/update/:id', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get user's club
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ error: 'No club associated with your account' });
    }
    
    const { id } = req.params;
    const { link } = req.body;
    
    const { data, error: updateError } = await supabase
        .from('shortcuts')
        .update({ link })
        .eq('id', id)
        .eq('club', club.name)
        .select()
        .single();

    if (updateError) {
        return res.status(500).json({ error: 'Error updating shortcut' });
    }
    
    if (!data) {
        return res.status(404).json({ error: 'Shortcut not found or not owned by your club' });
    }
    
    res.json({ success: true, data });
});
app.delete('/delete/:id', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get user's club
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ error: 'No club associated with your account' });
    }
    
    const { id } = req.params;
    
    const { error: deleteError } = await supabase
        .from('shortcuts')
        .delete()
        .eq('id', id)
        .eq('club', club.name);

    if (deleteError) {
        return res.status(500).json({ error: 'Error deleting shortcut' });
    }
    
    res.json({ success: true });
});
app.route('/club-index').get(async (req, res) => {
    res.render('club-index');
});

// Linklist Manager Dashboard - Get the manager page
app.route('/linklist-manager').get(async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.redirect('/login');
    }
    
    // Get user's club from clubs table
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).render('404');
    }
    
    res.render('linklist-manager', { user, clubName: club.name });
});

// Get links for a club (API endpoint)
app.route('/linklist/:club').get(async (req, res) => {
    const { club } = req.params;
    
    try {
        const { data: links, error } = await supabase
            .from('linklist')
            .select('*')
            .eq('club', club)
            .order('created_at', { ascending: false });
        
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch links' });
        }
        
        res.json({ links: links || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add a new link
app.post('/linklist/add', async (req, res) => {
    const token = req.cookies.token;
    const { headline, url, club } = req.body;
    
    if (!headline || !url) {
        return res.status(400).json({ error: 'Headline and URL are required' });
    }
    
    // If token exists, verify user owns the club
    if (token) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
            const { data: userClub } = await supabase
                .from('clubs')
                .select('name')
                .eq('id', user.id)
                .single();
            
            if (userClub?.name && userClub.name !== club) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
        }
    }
    
    try {
        const { data, error } = await supabase
            .from('linklist')
            .insert([{
                headline,
                url,
                club,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (error) {
            return res.status(500).json({ error: 'Failed to add link' });
        }
        
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete a link
app.delete('/linklist/:id', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get user's club
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ error: 'No club associated with your account' });
    }
    
    const { id } = req.params;
    
    try {
        // First, get the link to verify ownership
        const { data: linkData, error: linkError } = await supabase
            .from('linklist')
            .select('*')
            .eq('id', id)
            .single();
        
        if (linkError || !linkData) {
            return res.status(404).json({ error: 'Link not found' });
        }
        
        if (linkData.club !== club.name) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const { error: deleteError } = await supabase
            .from('linklist')
            .delete()
            .eq('id', id);
        
        if (deleteError) {
            return res.status(500).json({ error: 'Failed to delete link' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Public linktree view - displays all links for a club
app.route('/linktree/:club').get(async (req, res) => {
    const { club } = req.params;
    
    try {
        // Fetch club data including logo field
        const { data: clubData, error: clubError } = await supabase
            .from('clubs')
            .select('logo')
            .eq('name', club)
            .single();
        
        const { data: links, error } = await supabase
            .from('linklist')
            .select('*')
            .eq('club', club)
            .order('created_at', { ascending: false });
        
        if (error) {
            return res.render('404');
        }
        
        // Use logo from database if available, otherwise check for image file
        let logoPath = clubData?.logo || null;
        
        // If no logo in database, check for image files in logos folder
        if (!logoPath) {
            const logoExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
            for (const ext of logoExtensions) {
                const possiblePath = path.join(__dirname, 'views', 'logos', `${club}${ext}`);
                if (fs.existsSync(possiblePath)) {
                    logoPath = `/logos/${club}${ext}`;
                    break;
                }
            }
        }
        
        res.render('linktree', { clubName: club, links: links || [], logoPath });
    } catch (error) {
        console.error('Error:', error);
        res.render('404');
    }
});

//ANY OTHER ROUTES MUST BE PLACED ABOVE THIS LINE
app.route('/:shortlink').get(async (req, res) => {
    const { shortlink } = req.params;
    const { data, error } = await supabase
    .from('shortcuts')
    .select('*')
    .eq('id', shortlink)
    .single();
    if (error || !data) {
        return res.status(404).render('404');
    }
    console.log(data.visits)
    //update the visits count
    await supabase
    .from('shortcuts')
    .update({ visits: (data.visits+1) })
    .eq('id', shortlink);
    res.redirect(data.link);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});