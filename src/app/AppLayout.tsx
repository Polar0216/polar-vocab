import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { navigation } from './navigation'
import { PwaStatus } from './PwaStatus'
import { useVocabulary } from './vocabulary-context'

function NavigationLinks() {
  return navigation.map(({ path, label, icon }) => <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to={path} key={path} end={path === '/'}><Icon name={icon} /><span>{label}</span></NavLink>)
}

export function AppLayout() {
  const { ready, loading, error, retry } = useVocabulary()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef(location.pathname)
  const currentPage = navigation.find((item) => item.path === location.pathname)?.label ?? '首页'

  useEffect(() => {
    document.title = `${currentPage} · Polar Vocab`
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus()
      previousPath.current = location.pathname
    }
  }, [location.pathname, currentPage])

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); mainRef.current?.focus() }}>跳转到主要内容</a>
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="Polar Vocab 首页">
        <span className="brand-symbol"><Icon name="leaf" /></span>
        <span><strong>Polar Vocab</strong><small>你的英德词汇空间</small></span>
      </NavLink>
      <p className="nav-caption">学习空间</p>
      <nav className="desktop-navigation" aria-label="主导航"><NavigationLinks /></nav>
      <div className="sidebar-note"><div className="sidebar-note-title"><span className="status-dot" />个人词库 · Phase 3</div><p>从零散遇见，到长久记住。</p><span>收集 · 整理 · 复习</span></div>
      <div className="sidebar-footer"><Icon name="globe" /><span>English & Deutsch</span></div>
    </aside>

    <div className="workspace">
      <div className="topbar">
        <div className="mobile-brand"><span className="brand-symbol"><Icon name="leaf" /></span><strong>Polar Vocab</strong></div>
        <p className="breadcrumb">个人学习空间<span>/</span><strong>{currentPage}</strong></p>
        <span className="shell-badge"><span className="status-dot" />{ready ? '本机离线词库' : loading ? '正在打开词库' : '词库尚未打开'}</span>
      </div>
      <main id="main-content" className="main-content" tabIndex={-1} ref={mainRef}>
        {error && <div role="alert" className="feedback feedback-error"><strong>本地词库未能打开</strong><p>{error}。当前无法保存，不会清空已有数据。</p><button className="button button-secondary" onClick={retry}>重新打开</button></div>}
        <Outlet />
        <PwaStatus />
        <footer className="page-footer"><span>Polar Vocab</span><p>慢慢收集，认真记住。</p><span className="footer-phase">Phase 3</span></footer>
      </main>
    </div>

    <nav className="bottom-navigation" aria-label="手机导航"><NavigationLinks /></nav>
  </div>
}
