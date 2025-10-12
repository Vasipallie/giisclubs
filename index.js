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
    res.render('chome', { user });
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
    
    const { link, customId } = req.body;
    
    // Generate random ID if no custom ID provided
    const id = customId || Math.random().toString(36).substring(2, 8);
    
    const { data, error: insertError } = await supabase
        .from('shortcuts')
        .insert([{ 
            id: id,
            link: link,
            club: userData.club
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



//ANY OTHER ROUTES MUST BE PLACED ABOVE THIS LINE
app.route('/:shortlink').get(async (req, res) => {
    const { shortlink } = req.params;
    const { data, error } = await supabase
    .from('shortcuts')
    .select('link')
    .eq('id', shortlink)
    .single();
    if (error || !data) {
        return res.status(404).render('404');
    }
    //update the visits count
    await supabase
    .from('shortcuts')
    .update({ visits: (data.visits || 0) + 1 })
    .eq('id', shortlink);
    res.redirect(data.link);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});