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

app.route('/signup').get(async (req, res) => {
    res.render('signup', { error: null, success: null });
});

app.post('/signup', async (req, res) => {
    try {
        const { email, password, clubName, description } = req.body;

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
                description: description
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
        .select('name, logo')
        .eq('id', user.id)
        .single();

    res.render('chome', { user, clubName: club?.name || '', clubLogo: club?.logo || '' });
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

// Get links for a club (API endpoint) - now sorted by order
app.route('/linklist/:club').get(async (req, res) => {
    const { club } = req.params;
    
    try {
        const { data: links, error } = await supabase
            .from('linklist')
            .select('*')
            .eq('club', club)
            .order('order', { ascending: true })
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

// ============================================
// FORM BUILDER ROUTES
// ============================================

// Ensure forms directory exists
const formsDir = path.join(__dirname, 'data', 'forms');
const responsesDir = path.join(__dirname, 'data', 'responses');
const uploadsDir = path.join(__dirname, 'data', 'uploads', 'forms');

if (!fs.existsSync(formsDir)) {
    fs.mkdirSync(formsDir, { recursive: true });
}
if (!fs.existsSync(responsesDir)) {
    fs.mkdirSync(responsesDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads/forms', express.static(uploadsDir));

const formFileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const unique = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, unique + '_' + safeName);
    }
});

const uploadFormFiles = multer({
    storage: formFileStorage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

function normalizeFormFields(fields) {
    const safeFields = Array.isArray(fields) ? fields : [];
    const looksSectioned = safeFields.length > 0 && typeof safeFields[0] === 'object' && Array.isArray(safeFields[0]?.questions);

    const sections = looksSectioned
        ? safeFields.map((s, sIdx) => ({
            id: s?.id ?? `section_${sIdx}`,
            title: typeof s?.title === 'string' ? s.title : '',
            description: typeof s?.description === 'string' ? s.description : '',
            questions: Array.isArray(s?.questions) ? s.questions : []
        }))
        : [{ id: 'main', title: '', description: '', questions: safeFields }];

    const flatFields = sections
        .flatMap(s => Array.isArray(s.questions) ? s.questions : [])
        .map((q, idx) => ({
            id: q?.id ?? `q_${idx + 1}`,
            type: typeof q?.type === 'string' ? q.type : 'text',
            label: typeof q?.label === 'string' && q.label.trim() ? q.label : `Question ${idx + 1}`,
            required: !!q?.required,
            placeholder: typeof q?.placeholder === 'string' ? q.placeholder : '',
            options: Array.isArray(q?.options) ? q.options : undefined,
            maxRating: q?.maxRating,
            scaleMin: q?.scaleMin,
            scaleMax: q?.scaleMax,
            labelMin: q?.labelMin,
            labelMax: q?.labelMax,
            allowMultiple: q?.allowMultiple,
            maxSize: q?.maxSize,
            gotoSections: Array.isArray(q?.gotoSections) ? q.gotoSections : undefined
        }));

    return { sections, flatFields, looksSectioned };
}

// Helper function to read forms for a club
function getClubForms(clubName) {
    const forms = [];
    if (fs.existsSync(formsDir)) {
        const files = fs.readdirSync(formsDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                try {
                    const formData = JSON.parse(fs.readFileSync(path.join(formsDir, file), 'utf8'));
                    if (formData.club === clubName) {
                        // Count responses
                        const responsesFile = path.join(responsesDir, `${formData.id}.json`);
                        let responseCount = 0;
                        if (fs.existsSync(responsesFile)) {
                            const responses = JSON.parse(fs.readFileSync(responsesFile, 'utf8'));
                            responseCount = responses.length;
                        }
                        forms.push({ ...formData, responseCount });
                    }
                } catch (e) {
                    console.error('Error reading form file:', e);
                }
            }
        });
    }
    return forms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Forms List Page
app.route('/forms').get(async (req, res) => {
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
    
    if (!club?.name) {
        return res.render('404');
    }
    
    const forms = getClubForms(club.name);
    const totalResponses = forms.reduce((sum, f) => sum + (f.responseCount || 0), 0);
    
    res.render('forms-list', { forms, totalResponses, clubName: club.name });
});

// Create New Form Page
app.route('/forms/new').get(async (req, res) => {
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
    
    if (!club?.name) {
        return res.render('404');
    }
    
    res.render('form-builder', { form: null, editing: false, clubName: club.name });
});

// Edit Form Page
app.route('/forms/edit/:formId').get(async (req, res) => {
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
    
    if (!club?.name) {
        return res.render('404');
    }
    
    const { formId } = req.params;
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.render('404');
    }
    
    const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
    
    if (form.club !== club.name) {
        return res.render('404');
    }
    
    res.render('form-builder', { form, editing: true, clubName: club.name });
});

// Get Form Responses JSON API
app.get('/forms/:formId/responses', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ success: false, error: 'No club found' });
    }
    
    const { formId } = req.params;
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.status(404).json({ success: false, error: 'Form not found' });
    }
    
    const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
    
    if (form.club !== club.name) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    const responsesPath = path.join(responsesDir, `${formId}.json`);
    let responses = [];
    
    if (fs.existsSync(responsesPath)) {
        responses = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
    }
    
    res.json({ success: true, responses });
});

// Save Form API
app.post('/forms/save', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ error: 'No club associated' });
    }
    
    const { id, title, description, fields, settings } = req.body;
    
    if (!title || !fields || fields.length === 0) {
        return res.status(400).json({ error: 'Title and fields are required' });
    }
    
    const formId = id || 'form_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    
    // If editing, verify ownership
    if (id) {
        const existingPath = path.join(formsDir, `${id}.json`);
        if (fs.existsSync(existingPath)) {
            const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
            if (existing.club !== club.name) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
        }
    }
    
    const formData = {
        id: formId,
        title,
        description,
        fields,
        settings: settings || {},
        club: club.name,
        createdAt: id ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    // Preserve createdAt if editing
    if (id) {
        const existingPath = path.join(formsDir, `${id}.json`);
        if (fs.existsSync(existingPath)) {
            const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
            formData.createdAt = existing.createdAt;
        }
    } else {
        formData.createdAt = new Date().toISOString();
    }
    
    fs.writeFileSync(path.join(formsDir, `${formId}.json`), JSON.stringify(formData, null, 2));
    
    res.json({ success: true, formId });
});

// Delete Form API (POST for compatibility)
app.post('/forms/delete/:formId', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ error: 'No club associated' });
    }
    
    const { formId } = req.params;
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.status(404).json({ error: 'Form not found' });
    }
    
    const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
    
    if (form.club !== club.name) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Delete form and its responses
    fs.unlinkSync(formPath);
    const responsesPath = path.join(responsesDir, `${formId}.json`);
    if (fs.existsSync(responsesPath)) {
        fs.unlinkSync(responsesPath);
    }
    
    res.json({ success: true });
});

// View Form (Public)
app.route('/forms/view/:formId').get(async (req, res) => {
    const { formId } = req.params;
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.render('404');
    }
    
    const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
    const normalized = normalizeFormFields(form.fields);
    res.render('form-view', { form, sections: normalized.sections });
});

// Submit Form Response (Public)
app.post('/forms/submit/:formId', uploadFormFiles.any(), async (req, res) => {
    const { formId } = req.params;
    const data = {};
    const isMultipart = req.is('multipart/form-data');

    if (isMultipart) {
        Object.entries(req.body || {}).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                data[key] = value;
            } else {
                data[key] = value;
            }
        });

        (req.files || []).forEach(file => {
            const entry = {
                filename: file.filename,
                originalName: file.originalname,
                size: file.size,
                mimeType: file.mimetype
            };
            if (!data[file.fieldname]) {
                data[file.fieldname] = entry;
            } else if (Array.isArray(data[file.fieldname])) {
                data[file.fieldname].push(entry);
            } else {
                data[file.fieldname] = [data[file.fieldname], entry];
            }
        });
    } else {
        Object.assign(data, req.body || {});
    }
    
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.status(404).json({ error: 'Form not found' });
    }
    
    const responsesPath = path.join(responsesDir, `${formId}.json`);
    let responses = [];
    
    if (fs.existsSync(responsesPath)) {
        responses = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
    }
    
    const newResponse = {
        id: 'resp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
        data: data,
        submittedAt: new Date().toISOString()
    };
    
    responses.push(newResponse);
    fs.writeFileSync(responsesPath, JSON.stringify(responses, null, 2));
    
    res.json({ success: true });
});

// View Responses Page
app.route('/forms/responses/:formId').get(async (req, res) => {
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
    
    if (!club?.name) {
        return res.render('404');
    }
    
    const { formId } = req.params;
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.render('404');
    }
    
    const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
    
    if (form.club !== club.name) {
        return res.render('404');
    }
    
    const responsesPath = path.join(responsesDir, `${formId}.json`);
    let responses = [];
    
    if (fs.existsSync(responsesPath)) {
        responses = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
    }
    
    const shareUrl = `${req.protocol}://${req.get('host')}/forms/view/${formId}`;
    const normalized = normalizeFormFields(form.fields);
    
    res.render('form-responses', { form, responses, shareUrl, fields: normalized.flatFields });
});

// Delete Individual Response
app.delete('/forms/responses/:formId/:responseId', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { data: club } = await supabase
        .from('clubs')
        .select('name')
        .eq('id', user.id)
        .single();
    
    if (!club?.name) {
        return res.status(403).json({ error: 'No club associated' });
    }
    
    const { formId, responseId } = req.params;
    const formPath = path.join(formsDir, `${formId}.json`);
    
    if (!fs.existsSync(formPath)) {
        return res.status(404).json({ error: 'Form not found' });
    }
    
    const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
    
    if (form.club !== club.name) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const responsesPath = path.join(responsesDir, `${formId}.json`);
    
    if (!fs.existsSync(responsesPath)) {
        return res.status(404).json({ error: 'No responses found' });
    }
    
    let responses = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
    responses = responses.filter(r => r.id !== responseId);
    fs.writeFileSync(responsesPath, JSON.stringify(responses, null, 2));
    
    res.json({ success: true });
});

// ============================================
// END FORM BUILDER ROUTES
// ============================================

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