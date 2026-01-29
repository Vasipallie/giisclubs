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
    const { data: userData } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();

    res.render('chome', { user, clubName: userData?.club || '' });
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
    
    console.log(user.id);
    // Get user's club from users table
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();
    
    console.log(userData.club);
    // Get all links for this club
    const { data: links, error: linksError } = await supabase
        .from('shortcuts')
        .select('*')
        .eq('club', userData.club)
    ;
    
    res.render('shorten', { user, club: userData.club, links: links || [] });
});

app.route('/qrcode').get(async (req, res) => {
    res.render('qrgen');
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
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();
    
    if (userError || !userData?.club) {
        return res.status(403).json({ error: 'No club associated with your account' });
    }
    
    const { id } = req.params;
    const { link } = req.body;
    
    const { data, error: updateError } = await supabase
        .from('shortcuts')
        .update({ link })
        .eq('id', id)
        .eq('club', userData.club)
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
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();
    
    if (userError || !userData?.club) {
        return res.status(403).json({ error: 'No club associated with your account' });
    }
    
    const { id } = req.params;
    
    const { error: deleteError } = await supabase
        .from('shortcuts')
        .delete()
        .eq('id', id)
        .eq('club', userData.club);

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
    
    // Get user's club from users table
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();
    
    if (userError || !userData?.club) {
        return res.status(403).render('404');
    }
    
    res.render('linklist-manager', { user, clubName: userData.club });
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
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('club')
                .eq('id', user.id)
                .single();
            
            if (!userError && userData?.club && userData.club !== club) {
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
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('club')
        .eq('id', user.id)
        .single();
    
    if (userError || !userData?.club) {
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
        
        if (linkData.club !== userData.club) {
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
        const { data: links, error } = await supabase
            .from('linklist')
            .select('*')
            .eq('club', club)
            .order('created_at', { ascending: false });
        
        if (error) {
            return res.render('404');
        }
        
        // Check for logo file with common extensions
        const logoExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
        let logoPath = null;
        
        for (const ext of logoExtensions) {
            const possiblePath = path.join(__dirname, 'views', 'logos', `${club}${ext}`);
            if (fs.existsSync(possiblePath)) {
                logoPath = `/logos/${club}-p${ext}`;
                break;
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