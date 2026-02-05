
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

// Multer configuration for image uploads (memory storage for serverless)
const imageStorage = multer.memoryStorage();

// Middleware to check if user is admin
async function isAdmin(req, res, next) {
    const token = req.cookies.token;
    
    if (!token) {
        return res.status(401).redirect('/login');
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        return res.status(401).redirect('/login');
    }
    
    // Check if user has admin role (you can add an 'is_admin' field to clubs table)
    const { data: club } = await supabase
        .from('clubs')
        .select('name, is_admin')
        .eq('id', user.id)
        .single();
    
    if (!club || !club.is_admin) {
        return res.status(403).send('Access denied. Admin privileges required.');
    }
    
    req.user = user;
    req.club = club;
    next();
}

// Admin Dashboard Route
app.get('/admin-dashboard', isAdmin, (req, res) => {
    const club = req.club;
    res.render('admin-dashboard', { 
        clubName: club?.name || 'Admin', 
        clubLogo: club?.logo || '',
        isAdmin: true 
    });
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
    const token = req.cookies.token;
    let isLoggedIn = false;
    if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        isLoggedIn = !!user;
    }
    res.render('index', { isLoggedIn });
});

app.route('/login').get(async (req, res) => {
    res.render('login');
})
// Logout route
app.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

app.route('/signup').get(async (req, res) => {
    res.render('signup', { error: null, success: null });
});

app.post('/signup', async (req, res) => {
    try {
        const { email, password, clubName, description, isAdmin } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        if (!clubName || !description) {
            return res.status(400).json({ error: 'Club name and description are required' });
        }

        // Validate password requirements
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        if (!/[A-Z]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
        }

        if (!/[0-9]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one number' });
        }

        // Check if club name already exists
        const { data: existingClub } = await supabase
            .from('clubs')
            .select('id')
            .eq('name', clubName)
            .single();

        if (existingClub) {
            return res.status(400).json({ error: 'A club with this name already exists' });
        }

        // Create user
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    clubName: clubName
                }
            }
        });

        if (authError) {
            console.error('Auth error:', authError);
            return res.status(400).json({ error: authError.message || 'Failed to create account' });
        }

        // Create club entry with user's UUID
        const { error: clubError } = await supabase
            .from('clubs')
            .insert({
                id: authData.user.id,
                name: clubName,
                description: description,
                is_admin: false
            });

        if (clubError) {
            console.error('Club creation error:', clubError);
            return res.status(400).json({ error: 'Failed to create club. Please try again.' });
        }

        res.json({ 
            success: true, 
            message: 'Account created successfully. You can now log in.'
        });

    } catch (error) {
        console.error('Error creating account:', error);
        res.status(500).json({ error: error.message });
    }
});
// Add Event page (club dashboard)
app.route('/add-event').get(async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.redirect('/login');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.redirect('/login');
    // Get club info including name, logo, and admin status
    const { data: club } = await supabase
        .from('clubs')
        .select('name, logo, is_admin')
        .eq('id', user.id)
        .single();
    if (!club?.name) return res.render('404');
    res.render('add-event', { message: null, error: null, clubName: club.name, clubLogo: club.logo || '', isAdmin: club.is_admin || false });
});

app.post('/add-event', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.redirect('/login');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.redirect('/login');
    // Get club info including name, logo, and admin status
    const { data: club } = await supabase
        .from('clubs')
        .select('name, logo, is_admin')
        .eq('id', user.id)
        .single();
    if (!club?.name) return res.render('404');
    const { event_name, description, date, target_grades, proposal_link } = req.body;
    if (!event_name || !description || !date || !target_grades || !proposal_link) {
        return res.render('add-event', { message: null, error: 'Please fill all fields including event name and proposal link.', clubName: club.name, clubLogo: club.logo || '', isAdmin: club.is_admin || false });
    }
    // Validate Google Docs link
    if (!proposal_link.includes('docs.google.com')) {
        return res.render('add-event', { message: null, error: 'Proposal must be a Google Docs link.', clubName: club.name, clubLogo: club.logo || '', isAdmin: club.is_admin || false });
    }
    // Insert event with approved set to false by default
    const { error: eventError } = await supabase
        .from('events')
        .insert({ 
            club: club.name, 
            club_id: user.id,
            event_name,
            description, 
            date, 
            target_grades,
            proposal_link,
            approved: false,
            budget_submitted: false,
            receipts_submitted: false
        });
    if (eventError) {
        console.error('Event insertion error:', eventError);
        return res.render('add-event', { message: null, error: 'Error adding event.', clubName: club.name, clubLogo: club.logo || '', isAdmin: club.is_admin || false });
    }
    res.render('add-event', { message: 'Event submitted for approval! Check back after admin approval to submit budget and receipts.', error: null, clubName: club.name, clubLogo: club.logo || '', isAdmin: club.is_admin || false });
});

// Manage Events page route
app.route('/manage-events').get(async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.redirect('/login');
        }
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.redirect('/login');
        }
        
        // Get club info including name, logo, and admin status
        const { data: club } = await supabase
            .from('clubs')
            .select('name, logo, is_admin')
            .eq('id', user.id)
            .single();
        
        const isAdmin = club?.is_admin || false;
        const clubName = club?.name || '';
        const clubLogo = club?.logo || '';
        
        // Fetch only this club's events
        const { data: events, error: eventsError } = await supabase
            .from('events')
            .select('id, club, event_name, description, date, approved, target_grades, proposal_link, budget_submitted, receipts_submitted, club_id')
            .eq('club_id', user.id)
            .order('date', { ascending: false });
        
        if (eventsError) {
            console.error('Error fetching events:', eventsError);
            return res.render('manage-events', { events: [], message: null, error: 'Failed to load events.', isAdmin, clubName, clubLogo });
        }
        
        res.render('manage-events', { events: events || [], message: null, error: null, isAdmin, clubName, clubLogo });
    } catch (error) {
        console.error('Error:', error);
        res.render('manage-events', { events: [], message: null, error: 'An error occurred.', isAdmin: false, clubName: '', clubLogo: '' });
    }
});

// Get club's events API
app.get('/api/my-events', async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { data: { user } } = await supabase.auth.getUser(token);
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        // Fetch only this club's events
        const { data: events, error } = await supabase
            .from('events')
            .select('id, club, event_name, description, date, approved, target_grades, proposal_link, budget_submitted, receipts_submitted, club_id')
            .eq('club_id', user.id)
            .order('date', { ascending: false });
        
        if (error) {
            console.error('Error fetching events:', error);
            return res.status(500).json({ error: 'Failed to fetch events' });
        }
        
        res.json(events || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Multer configuration for file uploads
const fileStorage = multer.memoryStorage();
const fileUpload = multer({
    storage: fileStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, Excel, and Word documents are allowed.'));
        }
    }
});

// Submit budget files
app.post('/events/:id/budget', fileUpload.single('file'), async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { data: { user } } = await supabase.auth.getUser(token);
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { id } = req.params;
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        // Verify event belongs to user
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('club_id')
            .eq('id', id)
            .single();

        if (eventError || !event || event.club_id !== user.id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Upload file to Supabase Storage
        const fileName = `budgets/${user.id}/${id}/${Date.now()}-${req.file.originalname}`;
        const { error: uploadError } = await supabase.storage
            .from('event-files')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype
            });

        if (uploadError) {
            console.error('Upload error:', uploadError);
            return res.status(500).json({ error: 'Failed to upload file' });
        }

        // Update event to mark budget as submitted
        const { error: updateError } = await supabase
            .from('events')
            .update({ budget_submitted: true })
            .eq('id', id);

        if (updateError) {
            console.error('Update error:', updateError);
            return res.status(500).json({ error: 'Failed to update event' });
        }

        res.json({ success: true, message: 'Budget submitted successfully!' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
});

// Submit receipt files
app.post('/events/:id/receipts', fileUpload.array('files', 10), async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { data: { user } } = await supabase.auth.getUser(token);
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { id } = req.params;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files provided' });
        }

        // Verify event belongs to user
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('club_id')
            .eq('id', id)
            .single();

        if (eventError || !event || event.club_id !== user.id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Upload all files to Supabase Storage
        for (const file of req.files) {
            const fileName = `receipts/${user.id}/${id}/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage
                .from('event-files')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype
                });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                return res.status(500).json({ error: 'Failed to upload file' });
            }
        }

        // Update event to mark receipts as submitted
        const { error: updateError } = await supabase
            .from('events')
            .update({ receipts_submitted: true })
            .eq('id', id);

        if (updateError) {
            console.error('Update error:', updateError);
            return res.status(500).json({ error: 'Failed to update event' });
        }

        res.json({ success: true, message: 'Receipts submitted successfully!' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
});

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
        .select('name, logo, is_admin')
        .eq('id', user.id)
        .single();

    res.render('chome', { user, clubName: club?.name || '', clubLogo: club?.logo || '', isAdmin: club?.is_admin || false });
});
// Events page route
app.route('/events').get(async (req, res) => {
    // Check if user is authenticated to show sidebar info
    const token = req.cookies.token;
    let userClubName = '';
    let userClubLogo = '';
    let isAdmin = false;
    
    if (token) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
            const { data: club } = await supabase
                .from('clubs')
                .select('name, logo, is_admin')
                .eq('id', user.id)
                .single();
            if (club) {
                userClubName = club.name || '';
                userClubLogo = club.logo || '';
                isAdmin = club.is_admin || false;
            }
        }
    }
    
    // Fetch only approved events from Supabase
    const { data: eventsRaw, error: eventsError } = await supabase
        .from('events')
        .select('id, club, event_name, description, date')
        .eq('approved', true);

    let events = [];
    if (eventsRaw && eventsRaw.length > 0) {
        // Get club info for each event
        for (const event of eventsRaw) {
            let clubLogo = '';
            let clubName = event.club;
            // Try to get club logo and name from clubs table
            const { data: clubData } = await supabase
                .from('clubs')
                .select('name, logo')
                .eq('name', event.club)
                .single();
            if (clubData) {
                clubLogo = clubData.logo || '';
                clubName = clubData.name || event.club;
            }
            events.push({
                clubName,
                clubLogo,
                event_name: event.event_name || event.description,
                description: event.description,
                date: event.date
            });
        }
    }
    res.render('events', { events, clubName: userClubName, clubLogo: userClubLogo, isAdmin });
});


app.route('/explore').get(async (req, res) => {
    try {
        const token = req.cookies.token;
        let isLoggedIn = false;
        if (token) {
            const { data: { user } } = await supabase.auth.getUser(token);
            isLoggedIn = !!user;
        }
        
        // Get all clubs from the database (exclude admin accounts)
        const { data: clubs, error } = await supabase
            .from('clubs')
            .select('*')
            .eq('is_admin', false)
            .order('name', { ascending: true });
        
        if (error) {
            console.error('Error fetching clubs:', error);
            return res.render('explore', { clubs: [], isLoggedIn });
        }
        
        res.render('explore', { clubs: clubs || [], isLoggedIn });
    } catch (error) {
        console.error('Error in explore route:', error);
        res.render('explore', { clubs: [], isLoggedIn: false });
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
        .select('*')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.render('404');
    }
    
    // Check if user is admin
    const { data: adminData } = await supabase
        .from('admin')
        .select('id')
        .eq('user_id', user.id)
        .single();
    const isAdmin = !!adminData;
    
    // Get all links for this club
    const { data: links } = await supabase
        .from('shortcuts')
        .select('*')
        .eq('club', club.name);
    
    res.render('shorten', { 
        user, 
        club: club.name, 
        clubName: club.name,
        clubLogo: club.logo || null,
        isAdmin,
        links: links || [] 
    });
});

app.route('/qrcode').get(async (req, res) => {
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
        .select('*')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.render('404');
    }
    
    // Check if user is admin
    const { data: adminData } = await supabase
        .from('admin')
        .select('id')
        .eq('user_id', user.id)
        .single();
    const isAdmin = !!adminData;
    
    res.render('qrgen-new', { 
        user, 
        clubName: club.name,
        clubLogo: club.logo || null,
        isAdmin
    });
});

app.route('/qrgen').get(async (req, res) => {
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
        .select('*')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.render('404');
    }
    
    // Check if user is admin
    const { data: adminData } = await supabase
        .from('admin')
        .select('id')
        .eq('user_id', user.id)
        .single();
    const isAdmin = !!adminData;
    
    res.render('qrgen-new', { 
        user, 
        clubName: club.name,
        clubLogo: club.logo || null,
        isAdmin
    });
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
        return res.render('manage-club', { error: 'Club not found', success: null, club: {}, clubName: '', clubLogo: null, isAdmin: false });
    }

    // Check if user is admin
    const { data: adminData } = await supabase
        .from('admin')
        .select('id')
        .eq('user_id', user.id)
        .single();
    const isAdmin = !!adminData;

    res.render('manage-club', { 
        club: club || {}, 
        success: req.query.success || null, 
        error: null,
        clubName: club.name,
        clubLogo: club.logo || null,
        isAdmin
    });
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
        return res.render('manage-club', { error: 'Club not found', club: {}, success: null, clubName: '', clubLogo: null, isAdmin: false });
    }

    // Store club name in req so multer can access it
    req.clubName = club.name;
    
    // Now process uploads with multer
    uploadImages.fields([{ name: 'banner_upload', maxCount: 1 }, { name: 'logo_p_upload', maxCount: 1 }])(req, res, async (err) => {
        if (err) {
            console.error('Multer error:', err.message);
            return res.render('manage-club', { error: `Upload error: ${err.message}`, club: {}, success: null, clubName: club.name || '', clubLogo: null, isAdmin: false });
        }
        
        // Continue with the rest of the route
        const { description, link_text, link } = req.body;

        try {
            const updateData = {
                description,
                link_text,
                link
            };

            const bucket = process.env.SUPABASE_BUCKET || 'club-assets';
            const safeClubName = (club.name || 'club').trim().replace(/[\\/]/g, '-');

            const uploadToStorage = async (file, folder) => {
                const ext = path.extname(file.originalname).toLowerCase() || '.png';
                const storagePath = `${folder}/${safeClubName}${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from(bucket)
                    .upload(storagePath, file.buffer, {
                        contentType: file.mimetype,
                        upsert: true
                    });

                if (uploadError) {
                    throw uploadError;
                }

                const { data: publicUrlData } = supabase.storage
                    .from(bucket)
                    .getPublicUrl(storagePath);

                return publicUrlData?.publicUrl || null;
            };

            // If logo was uploaded, save the file URL
            if (req.files && req.files.logo_p_upload && req.files.logo_p_upload.length > 0) {
                const logoFile = req.files.logo_p_upload[0];
                const logoUrl = await uploadToStorage(logoFile, 'logos');
                if (logoUrl) {
                    updateData.logo = logoUrl;
                }
            }

            // If banner was uploaded, save the file URL
            if (req.files && req.files.banner_upload && req.files.banner_upload.length > 0) {
                const bannerFile = req.files.banner_upload[0];
                const bannerUrl = await uploadToStorage(bannerFile, 'resources');
                if (bannerUrl) {
                    updateData.banner = bannerUrl;
                }
            }

            // Update clubs table by user ID
            const { error: updateError } = await supabase
                .from('clubs')
                .update(updateData)
                .eq('id', user.id);

            if (updateError) {
                console.error('Supabase update error:', updateError);
                return res.render('manage-club', { error: 'Failed to update club profile', club: club, success: null, clubName: club.name || '', clubLogo: club.logo || null, isAdmin: false });
            }

            // Fetch updated club data
            const { data: updatedClub } = await supabase
                .from('clubs')
                .select('*')
                .eq('id', user.id)
                .single();

            res.render('manage-club', { club: updatedClub || club, success: 'Club profile updated successfully', error: null, clubName: (updatedClub || club).name || '', clubLogo: (updatedClub || club).logo || null, isAdmin: false });
        } catch (err) {
            console.error('Error in /manage-club POST:', err);
            res.render('manage-club', { error: 'An error occurred while updating your profile', club: club, success: null, clubName: club.name || '', clubLogo: club.logo || null, isAdmin: false });
        }
    });
});

app.post('/create', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's club
    const { data: clubData, error: clubError } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    const clubName = (clubData && clubData.name) ? clubData.name : 'robotics';
    
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
            club: clubName
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
    const token = req.cookies.token;
    let isLoggedIn = false;
    if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        isLoggedIn = !!user;
    }
    res.render('club-index', { isLoggedIn });
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
        .select('*')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).render('404');
    }
    
    // Check if user is admin
    const { data: adminData } = await supabase
        .from('admin')
        .select('id')
        .eq('user_id', user.id)
        .single();
    const isAdmin = !!adminData;
    
    res.render('linklist-manager', { 
        user, 
        clubName: club.name,
        clubLogo: club.logo || null,
        isAdmin
    });
});

// Get links for a club (API endpoint) - now sorted by order

// API: Get links as JSON for manager
app.get('/api/linklist/:club', async (req, res) => {
    const { club } = req.params;
    
    try {
        const { data: links, error } = await supabase
            .from('linklist')
            .select('*')
            .eq('club', club)
            .order('order', { ascending: true });
        
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch links' });
        }
        
        res.json({ links: links || [] });
    } catch (error) {
        console.error('Error fetching links:', error);
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

// Edit a linklist link
app.put('/linklist/:id/edit', async (req, res) => {
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
    const { headline, url } = req.body;
    
    if (!headline || !url) {
        return res.status(400).json({ error: 'Headline and URL are required' });
    }
    
    try {
        // First, verify the link belongs to the user's club
        const { data: linkData } = await supabase
            .from('linklist')
            .select('*')
            .eq('id', id)
            .single();
        
        if (!linkData || linkData.club !== club.name) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const { error: updateError } = await supabase
            .from('linklist')
            .update({ headline, url })
            .eq('id', id);
        
        if (updateError) {
            return res.status(500).json({ error: 'Failed to update link' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reorder linklist links
app.put('/linklist/reorder', async (req, res) => {
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
    
    const { links } = req.body; // Array of { id, order }
    
    if (!Array.isArray(links)) {
        return res.status(400).json({ error: 'Links must be an array' });
    }
    
    try {
        for (const item of links) {
            // Verify each link belongs to user's club before updating
            const { data: linkData } = await supabase
                .from('linklist')
                .select('club')
                .eq('id', item.id)
                .single();
            
            if (!linkData || linkData.club !== club.name) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            
            await supabase
                .from('linklist')
                .update({ order: item.order })
                .eq('id', item.id);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Public linklist view - displays all links for a club
app.route('/linklist/:club').get(async (req, res) => {
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
        
        res.render('linklist', { clubName: club, links: links || [], logoPath });
    } catch (error) {
        console.error('Error:', error);
        res.render('404');
    }
});

// Admin Dashboard Routes
// Create a new user (admin only)
app.post('/admin/create-user', isAdmin, async (req, res) => {
    const { clubname, email, password } = req.body;
    
    if (!clubname || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    
    try {
        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        
        if (authError) {
            return res.status(400).json({ error: authError.message || 'Failed to create account' });
        }
        
        // Create club entry with user's UUID
        const { data: clubData, error: clubError } = await supabase
            .from('clubs')
            .insert({
                id: authData.user.id,
                name: clubname,
                is_admin: false
            })
            .select()
            .single();
        
        if (clubError) {
            return res.status(400).json({ error: 'Failed to create club. Please try again.' });
        }
        
        res.json({ 
            success: true,
            message: 'User created successfully',
            user: clubData
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Issue an alert (admin only)
app.post('/admin/issue-alert', isAdmin, async (req, res) => {
    const { title, message, severity } = req.body;
    
    if (!title || !message) {
        return res.status(400).json({ error: 'Title and message are required' });
    }
    
    try {
        const { data, error } = await supabase
            .from('alerts')
            .insert([{
                title,
                message,
                severity: severity || 'info',
                created_at: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (error) {
            return res.status(500).json({ error: 'Failed to create alert' });
        }
        
        res.json({ 
            success: true,
            message: 'Alert sent successfully',
            alert: data
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all users (admin only)
app.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clubs')
            .select('id, name, description, is_admin')
            .order('name', { ascending: true });
        
        if (error) {
            console.error('Error fetching users:', error);
            return res.status(500).json({ error: 'Failed to fetch users', details: error.message });
        }
        
        console.log('Fetched users:', data);
        res.json(data || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Reset user password (admin only)
app.put('/admin/users/:id/reset-password', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    try {
        // Update password in Supabase Auth
        const { data, error } = await supabase.auth.admin.updateUserById(id, {
            password: newPassword
        });
        
        if (error) {
            console.error('Password reset error:', error);
            return res.status(500).json({ error: 'Failed to reset password', details: error.message });
        }
        
        res.json({ 
            success: true,
            message: 'Password reset successfully'
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Delete user (admin only)
app.delete('/admin/users/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        // Delete from clubs table
        const { error: clubError } = await supabase
            .from('clubs')
            .delete()
            .eq('id', id);
        
        if (clubError) {
            return res.status(500).json({ error: 'Failed to delete user from database' });
        }
        
        // Delete from auth (optional - Supabase may handle cascade)
        try {
            await supabase.auth.admin.deleteUser(id);
        } catch (authError) {
            console.error('Auth deletion error:', authError);
        }
        
        res.json({ 
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update user (admin only)
app.put('/admin/users/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    
    try {
        const updateData = {};
        if (name) updateData.name = name;
        if (description) updateData.description = description;
        
        // Update club info
        const { data, error: clubError } = await supabase
            .from('clubs')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        
        if (clubError) {
            return res.status(500).json({ error: 'Failed to update user' });
        }
        
        res.json({ 
            success: true,
            message: 'User updated successfully',
            user: data
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all events with document links (admin only)
app.get('/admin/events/documents', isAdmin, async (req, res) => {
    try {
        const { data: events, error } = await supabase
            .from('events')
            .select('id, club, club_id, event_name, description, date, approved, target_grades, proposal_link, budget_submitted, receipts_submitted')
            .order('date', { ascending: false });
        
        if (error) {
            console.error('Error fetching events:', error);
            return res.status(500).json({ error: 'Failed to fetch events', details: error.message });
        }
        
        // For each event, fetch the file URLs from storage
        const eventsWithFiles = await Promise.all(events.map(async (event) => {
            const budgetFiles = [];
            const receiptFiles = [];
            
            // Get budget files
            if (event.budget_submitted) {
                const { data: budgetList } = await supabase.storage
                    .from('event-files')
                    .list(`budgets/${event.club_id}/${event.id}`);
                
                if (budgetList && budgetList.length > 0) {
                    for (const file of budgetList) {
                        const { data: urlData } = supabase.storage
                            .from('event-files')
                            .getPublicUrl(`budgets/${event.club_id}/${event.id}/${file.name}`);
                        
                        budgetFiles.push({
                            name: file.name,
                            url: urlData.publicUrl
                        });
                    }
                }
            }
            
            // Get receipt files
            if (event.receipts_submitted) {
                const { data: receiptList } = await supabase.storage
                    .from('event-files')
                    .list(`receipts/${event.club_id}/${event.id}`);
                
                if (receiptList && receiptList.length > 0) {
                    for (const file of receiptList) {
                        const { data: urlData } = supabase.storage
                            .from('event-files')
                            .getPublicUrl(`receipts/${event.club_id}/${event.id}/${file.name}`);
                        
                        receiptFiles.push({
                            name: file.name,
                            url: urlData.publicUrl
                        });
                    }
                }
            }
            
            return {
                ...event,
                budget_files: budgetFiles,
                receipt_files: receiptFiles
            };
        }));
        
        res.json(eventsWithFiles || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Get all events (admin only)
app.get('/admin/events', isAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('events')
            .select('id, club, event_name, description, date, approved, target_grades, proposal_link, budget_submitted, receipts_submitted')
            .order('date', { ascending: false });
        
        if (error) {
            console.error('Error fetching events:', error);
            return res.status(500).json({ error: 'Failed to fetch events', details: error.message });
        }
        
        console.log('Fetched events:', data);
        res.json(data || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Approve event (admin only)
app.put('/admin/events/:id/approve', isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        const { data, error } = await supabase
            .from('events')
            .update({ approved: true })
            .eq('id', id)
            .select()
            .single();
        
        if (error) {
            console.error('Error approving event:', error);
            return res.status(500).json({ error: 'Failed to approve event', details: error.message });
        }
        
        res.json({ 
            success: true,
            message: 'Event approved successfully',
            event: data
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Delete event (admin only)
app.delete('/admin/events/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        const { error } = await supabase
            .from('events')
            .delete()
            .eq('id', id);
        
        if (error) {
            console.error('Error deleting event:', error);
            return res.status(500).json({ error: 'Failed to delete event', details: error.message });
        }
        
        res.json({ 
            success: true,
            message: 'Event deleted successfully'
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Get all alerts (admin only)
app.get('/admin/alerts', isAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('alerts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch alerts' });
        }
        
        res.json(data || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json([]);
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