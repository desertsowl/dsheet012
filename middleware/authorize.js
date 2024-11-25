const { User } = require('../models/User');

function authorize(allowedGroups) {
    return async (req, res, next) => {
        if (!req.session || !req.session.userId) {
            return res.status(401).render('result', {
                title: 'アクセス拒否',
                message: 'ログインが必要です。',
                backLink: '/login'
            });
        }

        try {
            const user = await User.findById(req.session.userId);
            if (!user) {
                return res.status(403).render('result', {
                    title: 'アクセス拒否',
                    message: 'ユーザー情報を確認できません。',
                    backLink: '/login'
                });
            }

            if (!allowedGroups.includes(user.group)) {
                return res.status(403).render('result', {
                    title: 'アクセス拒否',
                    message: 'このページにアクセスする権限がありません。',
                    backLink: '/'
                });
            }

            next();
        } catch (err) {
            console.error('Error during authorization:', err);
            res.status(500).render('result', {
                title: 'エラー',
                message: '認証処理中にエラーが発生しました。',
                backLink: '/'
            });
        }
    };
}

module.exports = { authorize };
