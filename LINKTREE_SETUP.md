# Linktree Clone - Setup Guide

## Overview
You now have a complete linktree clone system that allows clubs to manage and share their links!

## Features

### 1. **Link Manager Dashboard** (`/linklist-manager`)
- **Access**: Authenticated users from their club can access this
- **Features**:
  - ➕ Add new links with headline and URL
  - 📋 View all links for their club
  - 🗑️ Delete links
  - 👁️ Preview their public linktree

### 2. **Public Linktree View** (`/linktree/:club`)
- **Access**: Public (anyone can view)
- **Display**: 
  - Club name and icon
  - All links with headlines
  - Each link opens in a new tab
  - Beautiful gradient design

## Database Setup

You need to create a table in your Supabase database called `linklist` with these columns:

```sql
CREATE TABLE linklist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club TEXT NOT NULL,
  headline TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster club lookups
CREATE INDEX idx_linklist_club ON linklist(club);
```

## Routes

### Public Routes
- `GET /linktree/:club` - View linktree for a club (replace :club with club name)
  - Example: `/linktree/robotics`

### Authenticated Routes
- `GET /linklist-manager` - Manager dashboard
- `GET /linklist/:club` - Get all links for a club (API)
- `POST /linklist/add` - Add a new link
- `DELETE /linklist/:id` - Delete a link

## Usage

### For Club Members:
1. Login to their club account
2. Go to `/linklist-manager`
3. Add links with headlines
4. Share their linktree URL: `yourdomain.com/linktree/clubname`

### For Visitors:
1. Visit `/linktree/clubname`
2. Click any link to open it

## Files Created

1. **views/linktree.ejs** - Public linktree display page
2. **views/linklist-manager.ejs** - Manager dashboard
3. **Routes in index.js** - Backend routes for all functionality

## Customization Ideas

- Add link categories
- Add visit tracking
- Add custom backgrounds/themes
- Add social media icons
- Add analytics
- Add QR code generation for links
- Add link reordering (drag & drop)

## Security Notes

- Links are filtered by club (authenticated users can only see their club's links)
- Only authenticated users can add/delete links
- Deletion is verified against the user's club
