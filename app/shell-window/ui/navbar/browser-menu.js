/* globals beakerBrowser beakerDownloads DatArchive */

import os from 'os'
import * as yo from 'yo-yo'
import {ipcRenderer} from 'electron'
import emitStream from 'emit-stream'
import prettyBytes from 'pretty-bytes'
import { showInpageFind } from '../navbar'
import { ucfirst } from '../../../lib/strings'
import { findParent } from '../../../lib/fg/event-handlers'
import * as pages from '../../pages'

// there can be many drop menu btns rendered at once, but they are all showing the same information
// the BrowserMenuNavbarBtn manages all instances, and you should only create one

export class BrowserMenuNavbarBtn {
  constructor () {
    const isDarwin = os.platform() === 'darwin'
    const cmdOrCtrlChar = isDarwin ? '⌘' : '^'
    this.accelerators = {
      newWindow: cmdOrCtrlChar + 'N',
      newTab: cmdOrCtrlChar + 'T',
      findInPage: cmdOrCtrlChar + 'F',
      history: cmdOrCtrlChar + 'Y',
      openFile: cmdOrCtrlChar + 'O'
    }

    this.downloads = []
    this.sumProgress = null // null means no active downloads
    this.isDropdownOpen = false
    this.shouldPersistProgressBar = false

    // fetch current
    beakerDownloads.getDownloads().then(ds => {
      this.downloads = ds
      this.updateActives()
    })

    // wire up events
    var dlEvents = emitStream(beakerDownloads.eventsStream())
    dlEvents.on('new-download', this.onNewDownload.bind(this))
    dlEvents.on('sum-progress', this.onSumProgress.bind(this))
    dlEvents.on('updated', this.onUpdate.bind(this))
    dlEvents.on('done', this.onDone.bind(this))
    window.addEventListener('mousedown', this.onClickAnywhere.bind(this), true)
  }

  render () {
    // show active, then inactive, with a limit of 5 items
    var progressingDownloads = this.downloads.filter(d => d.state == 'progressing').reverse()
    var activeDownloads = (progressingDownloads.concat(this.downloads.filter(d => d.state != 'progressing').reverse())).slice(0, 5)

    // render the progress bar if downloading anything
    var progressEl = ''

    if ((progressingDownloads.length > 0 || this.shouldPersistProgressBar) && this.sumProgress && this.sumProgress.receivedBytes <= this.sumProgress.totalBytes) {
      progressEl = yo`<progress value=${this.sumProgress.receivedBytes} max=${this.sumProgress.totalBytes}></progress>`
    }

    // render the dropdown if open
    var dropdownEl = ''
    if (this.isDropdownOpen) {
      let downloadEls = activeDownloads.map(d => {
        // status
        var status = d.state === 'completed' ? '' : d.state
        if (status == 'progressing') {
          status = prettyBytes(d.receivedBytes) + ' / ' + prettyBytes(d.totalBytes)
          if (d.isPaused) { status += ', Paused' }
        } else { status = ucfirst(status) }

        // ctrls
        var ctrlsEl
        if (d.state == 'completed') {
          // actions
          if (!d.fileNotFound) {
            ctrlsEl = yo`
              <li class="download-item-ctrls complete">
                <a onclick=${e => this.onOpen(e, d)}>Open file</a>
                <a onclick=${e => this.onShow(e, d)}>Show in folder</a>
              </li>`
          } else {
            ctrlsEl = yo`
              <li class="download-item-ctrls not-found">
                File not found (moved or deleted)
              </li>`
          }
        } else if (d.state == 'progressing') {
          ctrlsEl = yo`
            <li class="download-item-ctrls paused">
              ${d.isPaused
                ? yo`<a onclick=${e => this.onResume(e, d)}>Resume</a>`
                : yo`<a onclick=${e => this.onPause(e, d)}>Pause</a>`}
              <a onclick=${e => this.onCancel(e, d)}>Cancel</a>
            </li>`
        }

        // render download
        return yo`
          <li class="download-item">
            <div class="name">${d.name}</div>
            <div class="status">
              ${d.state == 'progressing'
                ? yo`<progress value=${d.receivedBytes} max=${d.totalBytes}></progress>`
                : ''}
              ${status}
            </div>
            ${ctrlsEl}
          </li>`
      })
      dropdownEl = yo`
        <div class="toolbar-dropdown dropdown toolbar-dropdown-menu-dropdown">
          <div class="dropdown-items with-triangle">
            <div class="section">
              <div class="menu-item" onclick=${e => this.onOpenNewWindow()}>
                <i></i>
                <span class="label">New Window</span>
                <span class="shortcut">${this.accelerators.newWindow}</span>
              </div>

              <div class="menu-item" onclick=${e => this.onOpenNewTab()}>
                <i></i>
                <span class="label">New Tab</span>
                <span class="shortcut">${this.accelerators.newTab}</span>
              </div>
            </div>

            <div class="section">
              <div class="menu-item" onclick=${e => this.onFindInPage(e)}>
                <i class="fa fa-search"></i>
                <span class="label">Find in Page</span>
                <span class="shortcut">${this.accelerators.findInPage}</span>
              </div>
            </div>

            <div class="section">
              <div class="menu-item" onclick=${e => this.onCreateSite(e)}>
                <i class="fa fa-plus-square-o"></i>
                <span class="label">Create New Site</span>
              </div>
            </div>

            <div class="section">
              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'beaker://bookmarks')}>
                <i class="fa fa-star-o"></i>
                <span class="label">Bookmarks</span>
              </div>

              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'beaker://history')}>
                <i class="fa fa-clock-o"></i>
                <span class="label">History</span>
                <span class="shortcut">${this.accelerators.history}</span>
              </div>

              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'beaker://library')}>
                <i class="fa fa-code"></i>
                <span class="label">Beaker Filesystem</span>
              </div>

              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'beaker://downloads')}>
                <i class="fa fa-download"></i>
                <span class="label">Downloads</span>
              </div>
            </div>

            <div class="section">
              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'beaker://settings')}>
                <i class="fa fa-gear"></i>
                <span class="label">Settings</span>
              </div>
            </div>

            <div class="section">
              <div class="menu-item" onclick=${e => this.onOpenFile()}>
                <i></i>
                <span class="label">Open File...</span>
                <span class="shortcut">${this.accelerators.openFile}</span>
              </div>
            </div>

            <div class="section">
              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'dat://beakerbrowser.com/docs/')}>
                <i class="fa fa-question-circle-o"></i>
                <span class="label">Help</span>
              </div>

              <div class="menu-item" onclick=${e => this.onOpenPage(e, 'https://github.com/beakerbrowser/beaker/issues')}>
                <i class="fa fa-flag-o"></i>
                <span class="label">Report an Issue</span>
              </div>
            </div>
          </div>
        </div>`
    }

    // render btn
    return yo`
      <div class="toolbar-dropdown-menu browser-dropdown-menu">
        <button class="toolbar-btn toolbar-dropdown-menu-btn ${this.isDropdownOpen ? 'pressed' : ''}" onclick=${e => this.onClickBtn(e)} title="Menu">
          <span class="fa fa-bars"></span>
          ${progressEl}
        </button>
        ${dropdownEl}
      </div>`
  }

  updateActives () {
    Array.from(document.querySelectorAll('.browser-dropdown-menu')).forEach(el => yo.update(el, this.render()))
  }

  doAnimation () {
    Array.from(document.querySelectorAll('.browser-dropdown-menu .toolbar-btn')).forEach(el =>
      el.animate([
        {transform: 'scale(1.0)', color: 'inherit'},
        {transform: 'scale(1.5)', color: '#06c'},
        {transform: 'scale(1.0)', color: 'inherit'}
      ], { duration: 300 })
    )
  }

  onOpenNewWindow () {
    ipcRenderer.send('new-window')
  }

  onOpenNewTab () {
    pages.setActive(pages.create('beaker://start'))
  }

  async onOpenFile () {
    var files = await beakerBrowser.showOpenDialog({
       title: 'Open file...',
       properties: ['openFile', 'createDirectory']
    })
    if (files && files[0]) {
      pages.setActive(pages.create('file://' + files[0]))
    }
  }

  onClickBtn (e) {
    this.isDropdownOpen = !this.isDropdownOpen
    this.shouldPersistProgressBar = false // stop persisting if we were, the user clicked
    this.updateActives()
  }

  onClickAnywhere (e) {
    var parent = findParent(e.target, 'browser-dropdown-menu')
    if (parent) return // abort - this was a click on us!
    if (this.isDropdownOpen) {
      this.isDropdownOpen = false
      this.updateActives()
    }
  }

  onNewDownload () {
    this.doAnimation()

    // open the dropdown
    this.isDropdownOpen = true
    this.updateActives()
  }

  onSumProgress (sumProgress) {
    this.sumProgress = sumProgress
    this.updateActives()
  }

  onUpdate (download) {
    // patch data each time we get an update
    var target = this.downloads.find(d => d.id == download.id)
    if (target) {
      // patch item
      for (var k in download) { target[k] = download[k] }
    } else { this.downloads.push(download) }
    this.updateActives()
  }

  onDone (download) {
    this.shouldPersistProgressBar = true // keep progress bar up so the user notices
    this.doAnimation()
    this.onUpdate(download)
  }

  onPause (e, download) {
    e.preventDefault()
    e.stopPropagation()
    beakerDownloads.pause(download.id)
  }

  onResume (e, download) {
    e.preventDefault()
    e.stopPropagation()
    beakerDownloads.resume(download.id)
  }

  onCancel (e, download) {
    e.preventDefault()
    e.stopPropagation()
    beakerDownloads.cancel(download.id)
  }

  onShow (e, download) {
    e.preventDefault()
    e.stopPropagation()
    beakerDownloads.showInFolder(download.id)
      .catch(err => {
        download.fileNotFound = true
        this.updateActives()
      })
  }

  onOpen (e, download) {
    e.preventDefault()
    e.stopPropagation()
    beakerDownloads.open(download.id)
      .catch(err => {
        download.fileNotFound = true
        this.updateActives()
      })
  }

  onFindInPage (e) {
    e.preventDefault()
    e.stopPropagation()

    // close dropdown
    this.isDropdownOpen = false

    showInpageFind(pages.getActive())
  }

  onClearDownloads (e) {
    e.preventDefault()
    e.stopPropagation()
    this.downloads = []
    this.updateActives()
  }

  async onCreateSite (e) {
    // close dropdown
    this.isDropdownOpen = !this.isDropdownOpen
    this.updateActives()

    var archive = await DatArchive.create({prompt: true})
    pages.getActive().loadURL('beaker://library/' + archive.url.slice('dat://'.length))
  }

  onOpenPage (e, url) {
    pages.setActive(pages.create(url))
    this.isDropdownOpen = false
    this.updateActives()
  }
}
